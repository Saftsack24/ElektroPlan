import { Navigate } from "react-router-dom";

/** `/administration` führt auf die Benutzerliste. */
export default function AdministrationStart() {
  return <Navigate to="/administration/users" replace />;
}
