import PeerRoomPanel from "@/components/PeerRoomPanel";

export const metadata = {
  title: "Studium — PeerStudio",
};

export default function RoomPage() {
  return (
    <main className="room-page" id="contenu">
      <header className="page-heading">
        <p className="eyebrow">Animation en direct</p>
        <h1>PeerStudio</h1>
        <div className="page-heading__description">
          <p>Salle de révision par les pairs / Peer-review room</p>
        </div>
      </header>
      <PeerRoomPanel />
    </main>
  );
}
