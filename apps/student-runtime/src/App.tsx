import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold mb-2">Studium · runtime étudiant</h1>
        <p className="text-gray-600 mb-4">Hello world — M3 unité 6.</p>
        <Link to="/about" className="text-blue-600 underline">À propos</Link>
      </div>
    </main>
  );
}

function About() {
  return (
    <main className="p-8">
      <h2 className="text-xl font-semibold mb-2">À propos</h2>
      <Link to="/" className="text-blue-600 underline">Retour</Link>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </BrowserRouter>
  );
}
