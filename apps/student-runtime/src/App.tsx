import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Bootstrap from "./views/Bootstrap";
import ConsentScreen from "./views/ConsentScreen";
import LibraryScreen from "./views/LibraryScreen";
import SettingsScreen from "./views/SettingsScreen";

const router = createBrowserRouter([
  { path: "/",         element: <Bootstrap /> },
  { path: "/consent",  element: <ConsentScreen /> },
  { path: "/library",  element: <LibraryScreen /> },
  { path: "/settings", element: <SettingsScreen /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
