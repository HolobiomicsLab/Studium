import { StudioForm } from "./StudioForm";

export const metadata = {
  title: "Studium — Studio apprenant",
};

export default function StudioPage() {
  return (
    <div>
      <h2>Studio apprenant — propose un quiz</h2>
      <StudioForm />
    </div>
  );
}
