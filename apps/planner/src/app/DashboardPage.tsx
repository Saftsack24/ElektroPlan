import { useAuth } from "../core/auth/AuthProvider";
import { moduleRegistry } from "../modules";

export function DashboardPage() {
  const { me, activeModuleIds, permissions } = useAuth();
  const modules = moduleRegistry.all().filter((module) => activeModuleIds.has(module.id));

  return (
    <div className="stack">
      <section className="card">
        <h1>Willkommen, {me?.full_name}</h1>
        <p className="muted">
          Betrieb: <strong>{me?.organization.name}</strong> &middot; Rollen:{" "}
          {me?.roles.map((role) => role.name).join(", ") || "keine"}
        </p>
      </section>

      <section className="card">
        <h2>Aktive Module</h2>
        <ul className="list">
          {modules.map((module) => (
            <li key={module.id}>
              <strong>{module.name}</strong> <span className="muted">v{module.version}</span>
            </li>
          ))}
        </ul>
        <p className="muted">
          Die Projekt-Tabs der Fachmodule erscheinen automatisch in der Projektansicht —
          die Elektroplanung trägt dort seit Phase 3 „Räume &amp; Grundriss" bei. Neue
          Module tragen sich mit einer Zeile in <code>src/modules/index.ts</code> ein.
        </p>
      </section>

      <section className="card">
        <h2>Berechtigungen</h2>
        <ul className="list list--compact">
          {[...permissions].sort().map((permission) => (
            <li key={permission}>
              <code>{permission}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
