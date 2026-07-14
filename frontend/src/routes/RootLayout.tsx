import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { appBridge } from "../api/appBridge";

/** Binds appBridge navigation handlers that need the router. */
function AppBridgeBinder() {
  const navigate = useNavigate();
  useEffect(() => {
    appBridge.onRefereePending = () => navigate("/ref/pending");
    return () => {
      appBridge.onRefereePending = () => {};
    };
  }, [navigate]);
  return null;
}

export function RootLayout() {
  return (
    <>
      <AppBridgeBinder />
      <Outlet />
    </>
  );
}
