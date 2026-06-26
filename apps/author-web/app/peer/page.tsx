import { PeerBoard } from "./PeerBoard";

export const metadata = {
  title: "Studium — Test par les pairs",
};

export default function PeerPage() {
  return (
    <div>
      <h2>Test par les pairs — évalue l&apos;item d&apos;un camarade</h2>
      <PeerBoard />
    </div>
  );
}
