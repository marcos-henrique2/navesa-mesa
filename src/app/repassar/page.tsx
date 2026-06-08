import { CarrosPraRepassar } from "@/components/CarrosPraRepassar";
import { PageHeader } from "@/components/AppShell";

export default function RepassarPage() {
  return (
    <>
      <PageHeader
        title="Carros pra repassar"
        subtitle="Ranking automatizado dos carros que mais precisam de decisão essa semana"
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <CarrosPraRepassar />
      </div>
    </>
  );
}
