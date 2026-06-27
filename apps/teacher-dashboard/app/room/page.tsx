import PeerRoomPanel from "@/components/PeerRoomPanel";

export const metadata = {
  title: "Studium — PeerStudio",
};

export default function RoomPage() {
  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-6">
        PeerStudio — Salle de révision par les pairs / Peer-review room
      </h2>
      <PeerRoomPanel />
    </div>
  );
}
