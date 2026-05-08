import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Bootstrap from "./views/Bootstrap";
import ConsentScreen from "./views/ConsentScreen";
import LibraryScreen from "./views/LibraryScreen";
import LessonPlayer from "./views/LessonPlayer";
import LessonSummary from "./views/LessonSummary";
import SettingsScreen from "./views/SettingsScreen";

const router = createBrowserRouter([
  { path: "/",                         element: <Bootstrap /> },
  { path: "/consent",                  element: <ConsentScreen /> },
  { path: "/library",                  element: <LibraryScreen /> },
  { path: "/lesson/:lessonId",         element: <LessonPlayer /> },
  { path: "/lesson/:lessonId/summary", element: <LessonSummary /> },
  { path: "/settings",                 element: <SettingsScreen /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
