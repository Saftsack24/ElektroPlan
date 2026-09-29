/**
 * Imperative Szenenschicht der 3D-Ansicht (ADR 0016).
 *
 * Eine Instanz besitzt genau einen Renderer, eine Szene, eine Kamera und
 * einen Satz Controls - vom Konstruktor bis `entsorgen()`. React erzeugt sie
 * einmal je Mount und spricht sie nur über diese kleine API an:
 *
 * | Methode | Wirkung |
 * |---|---|
 * | `new Grundrissszene(...)` | initialisieren; wirft `WebGLNichtVerfuegbar` |
 * | `setzePlan(modell, { einpassen })` | Planobjekte ersetzen, alte GPU-Ressourcen freigeben |
 * | `setzeAuswahl(auswahl)` | Hervorhebung setzen (fachliche Referenz, kein Objekt) |
 * | `einpassen()` / `standardansicht()` / `draufsicht()` / `zoomen(f)` | Kamera |
 * | `groesseSetzen(b, h)` | Seitenverhältnis und Renderergröße, **ohne** Neuaufbau |
 * | `pausieren()` / `fortsetzen()` | kein Rendern, solange nicht sichtbar |
 * | `entsorgen()` | Canvas, Listener, Beobachter, Bildanforderung, Controls, Renderer, Geometrien, Materialien - alles |
 *
 * Gerendert wird **nur auf Anforderung**: nach einer Kamerabewegung (solange
 * die Dämpfung nachläuft), einer Größenänderung, einem neuen Plan oder einer
 * neuen Auswahl. Ohne Interaktion läuft keine Schleife. React wird nie pro
 * Bild benachrichtigt - nur bei einem Auswahlklick und bei Kontextverlust.
 *
 * Renderer, Controls, Bildtakt und Größenbeobachtung kommen über
 * `Umgebung` herein. Tests ersetzen sie; alles Übrige ist echtes Three.js
 * ohne WebGL-Kontext.
 */
import type { BufferGeometry, Material, Object3D } from "three";
import {
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from "three";

import { bodenGeometrie, oeffnungsGeometrie, umrissGeometrie, wandGeometrie } from "./geometrien";
import { MESSUNG, messen } from "./messung";
import type { Auswahl, Szenenmodell } from "./modell";
import { auswahlSchluessel } from "./modell";
import { LEERES_MODELL } from "./szenenmodell";

// ------------------------------------------------------------ Grenzen

/** Was die Szene vom Renderer braucht - `WebGLRenderer` erfüllt es. */
export interface RendererPort {
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(wert: number): void;
  setSize(breite: number, hoehe: number, stilSetzen?: boolean): void;
  setClearColor(farbe: Color | number, alpha?: number): void;
  render(szene: Object3D, kamera: PerspectiveCamera): void;
  dispose(): void;
  forceContextLoss(): void;
}

/** Was die Szene von den Controls braucht - `OrbitControls` erfüllt es. */
export interface ControlsPort {
  readonly target: Vector3;
  enableDamping: boolean;
  dampingFactor: number;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
  screenSpacePanning: boolean;
  update(): boolean;
  listenToKeyEvents(element: HTMLElement): void;
  stopListenToKeyEvents(): void;
  addEventListener(typ: "change", listener: () => void): void;
  removeEventListener(typ: "change", listener: () => void): void;
  dispose(): void;
}

export interface Umgebung {
  rendererErzeugen(): RendererPort;
  controlsErzeugen(kamera: PerspectiveCamera, zeigerflaeche: HTMLElement): ControlsPort;
  bildAnfordern(rueckruf: () => void): number;
  bildAbbrechen(id: number): void;
  /** Meldet die Größe des Behälters; liefert die Abmeldung. */
  groesseBeobachten(element: HTMLElement, rueckruf: (breite: number, hoehe: number) => void): () => void;
  pixelRatio(): number;
  dunkel(): boolean;
  /** Für `visibilitychange`; ohne Dokument pausiert die Szene nie von selbst. */
  readonly dokument: Document | null;
}

export interface Rueckmeldung {
  /** Ein Klick in die Szene hat etwas (oder nichts) ausgewählt. */
  auswahl(auswahl: Auswahl | null): void;
  /** Der Browser hat den WebGL-Kontext entzogen. */
  kontextVerloren(): void;
}

export class WebGLNichtVerfuegbar extends Error {
  constructor(ursache?: unknown) {
    super("WebGL ist in diesem Browser nicht verfügbar.", { cause: ursache });
    this.name = "WebGLNichtVerfuegbar";
  }
}

// ------------------------------------------------------------ Darstellung

/** Ruhige, unterscheidbare Bodenfarben - kein Signal, nur Orientierung. */
const BODENFARBEN = [0xd9e6d3, 0xd6e1ec, 0xeee2cc, 0xe4d9ea, 0xd2e9e3, 0xf0dad3, 0xe0e5c9, 0xd8dde9];

const FARBE = {
  wandAussen: 0x9aa6b3,
  wandGemeinsam: 0xe6e0d2,
  krone: 0x56616d,
  auswahl: 0xf0a030,
  auswahlKrone: 0xb86d12,
  glas: 0x8cc4ec,
  umriss: 0x45505c,
  hell: { hintergrund: 0xf4f6f8, raster: 0xb8c1cb, rasterFein: 0xdce1e7 },
  dunkel: { hintergrund: 0x1d232b, raster: 0x4a5663, rasterFein: 0x2f3842 },
} as const;

const SICHTFELD_GRAD = 45;
const ISO_RICHTUNG = new Vector3(0.9, 1.1, 1.3);
const DRAUFSICHT_RICHTUNG = new Vector3(0, 1, 0.0001);
/** Zeigerweg in Pixeln, bis aus einem Klick ein Ziehen (Drehen) wird. */
const KLICK_TOLERANZ_PX = 5;

interface Materialien {
  readonly boden: MeshLambertMaterial[];
  readonly bodenAuswahl: MeshLambertMaterial;
  readonly wandAussen: MeshLambertMaterial;
  readonly wandGemeinsam: MeshLambertMaterial;
  readonly krone: MeshLambertMaterial;
  readonly wandAuswahl: MeshLambertMaterial;
  readonly kroneAuswahl: MeshLambertMaterial;
  readonly glas: MeshLambertMaterial;
  readonly unsichtbar: MeshBasicMaterial;
  readonly oeffnungAuswahl: MeshBasicMaterial;
  readonly umriss: LineBasicMaterial;
}

function materialienErzeugen(): Materialien {
  return {
    boden: BODENFARBEN.map((color) => new MeshLambertMaterial({ color })),
    bodenAuswahl: new MeshLambertMaterial({ color: 0xf7c67a, emissive: 0x3a2600 }),
    wandAussen: new MeshLambertMaterial({ color: FARBE.wandAussen }),
    wandGemeinsam: new MeshLambertMaterial({ color: FARBE.wandGemeinsam }),
    krone: new MeshLambertMaterial({ color: FARBE.krone }),
    wandAuswahl: new MeshLambertMaterial({ color: FARBE.auswahl, emissive: 0x402200 }),
    kroneAuswahl: new MeshLambertMaterial({ color: FARBE.auswahlKrone }),
    glas: new MeshLambertMaterial({
      color: FARBE.glas,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false,
    }),
    // Tür und Durchgang: treffbar, aber nicht gezeichnet.
    unsichtbar: new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }),
    oeffnungAuswahl: new MeshBasicMaterial({
      color: FARBE.auswahl,
      transparent: true,
      opacity: 0.6,
      side: DoubleSide,
      depthWrite: false,
    }),
    umriss: new LineBasicMaterial({ color: FARBE.umriss }),
  };
}

function alleMaterialien(m: Materialien): Material[] {
  return [
    ...m.boden,
    m.bodenAuswahl,
    m.wandAussen,
    m.wandGemeinsam,
    m.krone,
    m.wandAuswahl,
    m.kroneAuswahl,
    m.glas,
    m.unsichtbar,
    m.oeffnungAuswahl,
    m.umriss,
  ];
}

interface Auswahlobjekt {
  readonly mesh: Mesh;
  readonly normal: Material | Material[];
  readonly hervorgehoben: Material | Material[];
}

// ------------------------------------------------------------ Szene

export class Grundrissszene {
  readonly kamera = new PerspectiveCamera(SICHTFELD_GRAD, 1, 0.05, 500);
  private readonly szene = new Scene();
  private readonly renderer: RendererPort;
  private readonly controls: ControlsPort;
  private readonly raycaster = new Raycaster();
  private readonly materialien = materialienErzeugen();
  private readonly planGruppe = new Group();
  private readonly lichter: Object3D[];
  private readonly dunkel: boolean;
  private raster: GridHelper | null = null;
  private readonly planGeometrien = new Set<BufferGeometry>();
  private auswaehlbar: Mesh[] = [];
  private readonly nachSchluessel = new Map<string, Auswahlobjekt[]>();
  private modell: Szenenmodell = LEERES_MODELL;
  private auswahl: Auswahl | null = null;
  private bildId: number | null = null;
  private pausiert = false;
  private entsorgt = false;
  private kontextWeg = false;
  private breite = 0;
  private hoehe = 0;
  private erstesBild = true;
  private zeigerStart: { x: number; y: number } | null = null;
  private readonly abmeldungen: (() => void)[] = [];

  constructor(
    private readonly behaelter: HTMLElement,
    private readonly umgebung: Umgebung,
    private readonly rueckmeldung: Rueckmeldung,
  ) {
    try {
      this.renderer = umgebung.rendererErzeugen();
    } catch (fehler) {
      this.materialienFreigeben();
      throw fehler instanceof WebGLNichtVerfuegbar ? fehler : new WebGLNichtVerfuegbar(fehler);
    }
    this.dunkel = umgebung.dunkel();
    const farben = this.dunkel ? FARBE.dunkel : FARBE.hell;
    this.renderer.setPixelRatio(Math.min(Math.max(umgebung.pixelRatio(), 1), 2));
    this.renderer.setClearColor(new Color(farben.hintergrund), 1);

    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.setAttribute("aria-hidden", "true");
    behaelter.appendChild(canvas);

    this.controls = umgebung.controlsErzeugen(this.kamera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 200;
    // Nie unter den Fußboden - von unten gibt es nichts zu sehen.
    this.controls.maxPolarAngle = MathUtils.degToRad(88);
    this.controls.listenToKeyEvents(behaelter);

    const hemisphaere = new HemisphereLight(0xffffff, 0x7a8591, 2.4);
    const sonne = new DirectionalLight(0xffffff, 1.6);
    sonne.position.set(6, 12, 8);
    this.lichter = [hemisphaere, sonne];
    this.szene.add(hemisphaere, sonne, this.planGruppe);

    this.anmelden();
    this.standardansicht();
  }

  // ------------------------------------------------------------ Ereignisse

  private readonly beiAenderung = () => this.anfordern();

  private readonly beiZeigerRunter = (ereignis: PointerEvent) => {
    this.zeigerStart = ereignis.button === 0 ? { x: ereignis.clientX, y: ereignis.clientY } : null;
  };

  private readonly beiZeigerHoch = (ereignis: PointerEvent) => {
    const start = this.zeigerStart;
    this.zeigerStart = null;
    if (start === null || ereignis.button !== 0) return;
    if (Math.hypot(ereignis.clientX - start.x, ereignis.clientY - start.y) > KLICK_TOLERANZ_PX) return;
    const rechteck = this.renderer.domElement.getBoundingClientRect();
    if (rechteck.width <= 0 || rechteck.height <= 0) return;
    const x = ((ereignis.clientX - rechteck.left) / rechteck.width) * 2 - 1;
    const y = -((ereignis.clientY - rechteck.top) / rechteck.height) * 2 + 1;
    this.rueckmeldung.auswahl(this.auswahlBei(x, y));
  };

  private readonly beiKontextverlust = (ereignis: Event) => {
    ereignis.preventDefault();
    this.kontextWeg = true;
    this.bildVerwerfen();
    this.rueckmeldung.kontextVerloren();
  };

  private readonly beiSichtbarkeit = () => {
    if (this.umgebung.dokument?.visibilityState === "hidden") this.pausieren();
    else this.fortsetzen();
  };

  private anmelden() {
    const canvas = this.renderer.domElement;
    this.controls.addEventListener("change", this.beiAenderung);
    canvas.addEventListener("pointerdown", this.beiZeigerRunter);
    canvas.addEventListener("pointerup", this.beiZeigerHoch);
    canvas.addEventListener("webglcontextlost", this.beiKontextverlust);
    this.umgebung.dokument?.addEventListener("visibilitychange", this.beiSichtbarkeit);
    const groesseAbmelden = this.umgebung.groesseBeobachten(this.behaelter, (b, h) => this.groesseSetzen(b, h));
    this.abmeldungen.push(
      () => this.controls.removeEventListener("change", this.beiAenderung),
      () => canvas.removeEventListener("pointerdown", this.beiZeigerRunter),
      () => canvas.removeEventListener("pointerup", this.beiZeigerHoch),
      () => canvas.removeEventListener("webglcontextlost", this.beiKontextverlust),
      () => this.umgebung.dokument?.removeEventListener("visibilitychange", this.beiSichtbarkeit),
      groesseAbmelden,
    );
  }

  // ------------------------------------------------------------ Bildtakt

  private anfordern() {
    if (this.entsorgt || this.pausiert || this.kontextWeg || this.bildId !== null) return;
    if (this.breite <= 0 || this.hoehe <= 0) return;
    this.bildId = this.umgebung.bildAnfordern(this.bild);
  }

  private readonly bild = () => {
    this.bildId = null;
    if (this.entsorgt || this.pausiert || this.kontextWeg) return;
    // Die Dämpfung läuft nach; `update` meldet, ob sich noch etwas bewegt.
    const bewegt = this.controls.update();
    if (this.erstesBild) {
      this.erstesBild = false;
      messen(MESSUNG.erstesBild, () => this.renderer.render(this.szene, this.kamera));
    } else {
      this.renderer.render(this.szene, this.kamera);
    }
    if (bewegt) this.anfordern();
  };

  private bildVerwerfen() {
    if (this.bildId !== null) this.umgebung.bildAbbrechen(this.bildId);
    this.bildId = null;
  }

  pausieren() {
    this.pausiert = true;
    this.bildVerwerfen();
  }

  fortsetzen() {
    if (!this.pausiert) return;
    this.pausiert = false;
    this.anfordern();
  }

  groesseSetzen(breite: number, hoehe: number) {
    if (this.entsorgt) return;
    const b = Math.floor(breite);
    const h = Math.floor(hoehe);
    if (b <= 0 || h <= 0) {
      // Vorübergehend ohne Platz (eingeklappt, ausgeblendet): nicht rendern.
      this.breite = 0;
      this.hoehe = 0;
      this.bildVerwerfen();
      return;
    }
    if (b === this.breite && h === this.hoehe) return;
    this.breite = b;
    this.hoehe = h;
    this.renderer.setSize(b, h, false);
    this.kamera.aspect = b / h;
    this.kamera.updateProjectionMatrix();
    this.anfordern();
  }

  // ------------------------------------------------------------ Plan

  setzePlan(modell: Szenenmodell, optionen: { einpassen: boolean }) {
    if (this.entsorgt) return;
    this.modell = modell;
    messen(MESSUNG.geometrie, () => this.planAufbauen(modell));
    const bisher = this.auswahl;
    if (bisher !== null && !this.nachSchluessel.has(auswahlSchluessel(bisher))) this.auswahl = null;
    this.hervorhebungAnwenden();
    if (optionen.einpassen) this.standardansicht();
    else this.anfordern();
  }

  private planAufbauen(modell: Szenenmodell) {
    this.planLeeren();
    const t = modell.transformation;
    const m = this.materialien;

    for (const raum of modell.raeume) {
      const boden = bodenGeometrie(raum, t);
      if (boden !== null) {
        const material = m.boden[raum.farbindex % m.boden.length] as MeshLambertMaterial;
        this.auswaehlbarHinzufuegen(new Mesh(boden, material), { art: "raum", id: raum.id }, m.bodenAuswahl);
      }
      this.planHinzufuegen(new LineLoop(umrissGeometrie(raum, t), m.umriss));
    }

    for (const wand of modell.waende) {
      const koerper = wandGeometrie(wand, t);
      if (koerper !== null) {
        const seite = wand.lage === "gemeinsam" ? m.wandGemeinsam : m.wandAussen;
        this.auswaehlbarHinzufuegen(new Mesh(koerper, [seite, m.krone]), { art: "wand", id: wand.id }, [
          m.wandAuswahl,
          m.kroneAuswahl,
        ]);
      }
      for (const oeffnung of wand.oeffnungen) {
        const flaeche = new Mesh(
          oeffnungsGeometrie(oeffnung, wand, t),
          oeffnung.art === "window" ? m.glas : m.unsichtbar,
        );
        flaeche.renderOrder = 1;
        this.auswaehlbarHinzufuegen(flaeche, { art: "oeffnung", id: oeffnung.id }, m.oeffnungAuswahl);
      }
    }
    this.rasterSetzen(modell);
  }

  private planHinzufuegen(objekt: Mesh | LineLoop) {
    this.planGeometrien.add(objekt.geometry);
    this.planGruppe.add(objekt);
  }

  private auswaehlbarHinzufuegen(mesh: Mesh, auswahl: Auswahl, hervorgehoben: Material | Material[]) {
    mesh.userData = { auswahl };
    this.planHinzufuegen(mesh);
    this.auswaehlbar.push(mesh);
    const schluessel = auswahlSchluessel(auswahl);
    const liste = this.nachSchluessel.get(schluessel) ?? [];
    liste.push({ mesh, normal: mesh.material, hervorgehoben });
    this.nachSchluessel.set(schluessel, liste);
  }

  /** Ersetzte GPU-Ressourcen freigeben. Materialien gehören der Szene, nicht dem Plan. */
  private planLeeren() {
    this.planGruppe.clear();
    for (const geometrie of this.planGeometrien) geometrie.dispose();
    this.planGeometrien.clear();
    this.auswaehlbar = [];
    this.nachSchluessel.clear();
  }

  private rasterSetzen(modell: Szenenmodell) {
    const g = modell.grenzen;
    const ausdehnungM = g === null ? 0 : Math.max(g.maxX - g.minX, g.maxY - g.minY) / 1000;
    const groesse = Math.max(10, Math.ceil(ausdehnungM + 6));
    if (this.raster !== null && this.raster.userData["groesse"] === groesse) return;
    this.rasterEntfernen();
    const farben = this.dunkel ? FARBE.dunkel : FARBE.hell;
    const raster = new GridHelper(groesse, groesse, farben.raster, farben.rasterFein);
    raster.userData = { groesse };
    // Zuerst und ohne Tiefe zeichnen: Böden und Wände überdecken das Raster
    // immer - sonst scheinen Rasterlinien durch die knapp darüber liegenden Böden.
    raster.material.depthWrite = false;
    raster.renderOrder = -1;
    this.raster = raster;
    this.szene.add(raster);
  }

  private rasterEntfernen() {
    if (this.raster === null) return;
    this.szene.remove(this.raster);
    this.raster.geometry.dispose();
    (this.raster.material as Material).dispose();
    this.raster = null;
  }

  // ------------------------------------------------------------ Auswahl

  /** Treffer an einer Bildposition (normierte Gerätekoordinaten −1 … 1). */
  auswahlBei(x: number, y: number): Auswahl | null {
    this.raycaster.setFromCamera(new Vector2(x, y), this.kamera);
    // Nur die auswählbaren Objekte - Raster, Umrisse und Lichter nicht.
    const treffer = this.raycaster.intersectObjects(this.auswaehlbar, false)[0];
    const auswahl = treffer?.object.userData["auswahl"] as Auswahl | undefined;
    return auswahl ?? null;
  }

  setzeAuswahl(auswahl: Auswahl | null) {
    if (this.entsorgt) return;
    this.auswahl = auswahl !== null && this.nachSchluessel.has(auswahlSchluessel(auswahl)) ? auswahl : null;
    this.hervorhebungAnwenden();
    this.anfordern();
  }

  aktuelleAuswahl(): Auswahl | null {
    return this.auswahl;
  }

  private hervorhebungAnwenden() {
    const aktiv = this.auswahl === null ? null : auswahlSchluessel(this.auswahl);
    for (const [schluessel, objekte] of this.nachSchluessel) {
      for (const o of objekte) o.mesh.material = schluessel === aktiv ? o.hervorgehoben : o.normal;
    }
  }

  // ------------------------------------------------------------ Kamera

  /** Mittelpunkt und Radius der Szene in Metern (Kugel um Grundriss und Höhe). */
  private ausdehnung(): { mitte: Vector3; radius: number } {
    const g = this.modell.grenzen;
    if (g === null) return { mitte: new Vector3(0, 0, 0), radius: 5 };
    const t = this.modell.transformation;
    const breite = (g.maxX - g.minX) / 1000;
    const tiefe = (g.maxY - g.minY) / 1000;
    const hoehe = this.modell.hoeheMaxMm / 1000;
    const mitte = new Vector3(
      ((g.minX + g.maxX) / 2 - t.mitteXMm) / 1000,
      hoehe / 4,
      (t.mitteYMm - (g.minY + g.maxY) / 2) / 1000,
    );
    return { mitte, radius: Math.max(1, 0.5 * Math.hypot(breite, tiefe, hoehe)) };
  }

  private blickSetzen(richtung: Vector3) {
    const { mitte, radius } = this.ausdehnung();
    const senkrecht = MathUtils.degToRad(this.kamera.fov);
    const waagerecht = 2 * Math.atan(Math.tan(senkrecht / 2) * this.kamera.aspect);
    const abstand = (radius / Math.sin(Math.min(senkrecht, waagerecht) / 2)) * 1.05;
    this.kamera.position.copy(mitte).addScaledVector(richtung.clone().normalize(), abstand);
    this.kamera.near = Math.max(0.01, abstand / 1000);
    this.kamera.far = Math.max(100, abstand * 20);
    this.kamera.updateProjectionMatrix();
    this.controls.target.copy(mitte);
    this.controls.maxDistance = Math.max(30, abstand * 5);
    // Selbst ausrichten, nicht auf die Controls verlassen.
    this.kamera.lookAt(mitte);
    this.controls.update();
    this.anfordern();
  }

  /** Gesamten Grundriss zeigen - aus der aktuellen Blickrichtung. */
  einpassen() {
    const richtung = this.kamera.position.clone().sub(this.controls.target);
    this.blickSetzen(richtung.lengthSq() > 0 ? richtung : ISO_RICHTUNG);
  }

  /** Isometrische Standardansicht von schräg oben (Süden/Osten). */
  standardansicht() {
    this.blickSetzen(ISO_RICHTUNG);
  }

  /** Draufsicht: Norden oben, wie im 2D-Editor. */
  draufsicht() {
    this.blickSetzen(DRAUFSICHT_RICHTUNG);
  }

  /** Faktor > 1 nähert an, < 1 entfernt - innerhalb der Distanzgrenzen. */
  zoomen(faktor: number) {
    if (!(faktor > 0)) return;
    const versatz = this.kamera.position.clone().sub(this.controls.target);
    const abstand = MathUtils.clamp(
      versatz.length() / faktor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.kamera.position.copy(this.controls.target).addScaledVector(versatz.normalize(), abstand);
    this.kamera.lookAt(this.controls.target);
    this.controls.update();
    this.anfordern();
  }

  // ------------------------------------------------------------ Ende

  private materialienFreigeben() {
    for (const material of alleMaterialien(this.materialien)) material.dispose();
  }

  /** Alles freigeben. Mehrfacher Aufruf ist unschädlich. */
  entsorgen() {
    if (this.entsorgt) return;
    this.entsorgt = true;
    this.bildVerwerfen();
    for (const abmelden of this.abmeldungen.splice(0)) abmelden();
    this.controls.stopListenToKeyEvents();
    this.controls.dispose();
    this.planLeeren();
    this.rasterEntfernen();
    this.szene.remove(...this.lichter);
    for (const licht of this.lichter) (licht as DirectionalLight | HemisphereLight).dispose();
    this.materialienFreigeben();
    this.renderer.dispose();
    try {
      // Gibt den Kontext sofort frei - sonst stauen sich Kontexte bei
      // häufigem Ansichtswechsel, bis der Browser alte verwirft.
      this.renderer.forceContextLoss();
    } catch {
      // Ohne Erweiterung WEBGL_lose_context bleibt es beim dispose().
    }
    this.renderer.domElement.remove();
  }

  /** Diagnose für Tests und Messung - keine Three.js-Objekte nach außen. */
  statistik() {
    return {
      planGeometrien: this.planGeometrien.size,
      auswaehlbar: this.auswaehlbar.length,
      materialien: alleMaterialien(this.materialien).length,
      raster: this.raster === null ? 0 : 1,
      bildAngefordert: this.bildId !== null,
      pausiert: this.pausiert,
      entsorgt: this.entsorgt,
      breite: this.breite,
      hoehe: this.hoehe,
    };
  }
}
