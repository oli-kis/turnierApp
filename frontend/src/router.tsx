import { createBrowserRouter, Navigate } from "react-router-dom";
import { RootLayout } from "./routes/RootLayout";

// Public
import { HomePicker } from "./routes/public/HomePicker";
import { TournamentLayout } from "./routes/public/TournamentLayout";
import { TournamentHome } from "./routes/public/TournamentHome";
import { CategoryPage } from "./routes/public/CategoryPage";
import { GroupPage } from "./routes/public/GroupPage";
import { BracketPage } from "./routes/public/BracketPage";
import { TeamsSearch } from "./routes/public/TeamsSearch";
import { TeamPage } from "./routes/public/TeamPage";
import { BeamerView } from "./routes/public/BeamerView";
import { Register } from "./routes/public/Register";
import { RegistrationStatus } from "./routes/public/RegistrationStatus";

// Auth / Referee
import { Login } from "./routes/auth/Login";
import { RefereeRegister } from "./routes/referee/RefereeRegister";
import { RefereePending } from "./routes/referee/RefereePending";
import { RefereeLayout } from "./routes/referee/RefereeLayout";
import { RefereeHome } from "./routes/referee/RefereeHome";
import { RefereeMatch } from "./routes/referee/RefereeMatch";

// Admin
import { AdminLayout } from "./routes/admin/AdminLayout";
import { AdminList } from "./routes/admin/AdminList";
import { AdminReferees } from "./routes/admin/AdminReferees";
import { AdminSetup } from "./routes/admin/AdminSetup";
import { AdminLive } from "./routes/admin/AdminLive";
import { AdminMatches } from "./routes/admin/AdminMatches";
import { AdminMatchEditor } from "./routes/admin/AdminMatchEditor";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomePicker /> },
      { path: "/login", element: <Login mode="admin" /> },

      {
        path: "/t/:id",
        element: <TournamentLayout />,
        children: [
          { index: true, element: <TournamentHome /> },
          { path: "kategorie/:catId", element: <CategoryPage /> },
          { path: "gruppe/:groupId", element: <GroupPage /> },
          { path: "tabelle", element: <BracketPage /> },
          { path: "teams", element: <TeamsSearch /> },
          { path: "anmelden", element: <Register /> },
          // Stripe's success_url lands here. Inside the layout on purpose: the
          // payer has just paid and should be one tap from the tournament.
          { path: "anmeldung/status", element: <RegistrationStatus /> },
        ],
      },
      { path: "/team/:teamId", element: <TeamPage /> },

      // Outside TournamentLayout on purpose: the beamer gets no nav, no header,
      // no max-width — the whole screen is the display.
      { path: "/t/:id/beamer", element: <BeamerView /> },

      { path: "/ref/login", element: <Login mode="referee" /> },
      { path: "/ref/registrieren", element: <RefereeRegister /> },
      { path: "/ref/pending", element: <RefereePending /> },
      {
        path: "/ref",
        element: <RefereeLayout />,
        children: [
          { index: true, element: <RefereeHome /> },
          { path: "spiel/:id", element: <RefereeMatch /> },
        ],
      },

      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminList /> },
          { path: "referees", element: <AdminReferees /> },
          { path: "t/:id/setup", element: <AdminSetup /> },
          { path: "t/:id/live", element: <AdminLive /> },
          { path: "t/:id/spiele", element: <AdminMatches /> },
          { path: "t/:id/spiel/:matchId", element: <AdminMatchEditor /> },
        ],
      },

      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
