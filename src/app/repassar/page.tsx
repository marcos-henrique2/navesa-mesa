import { CarrosPraRepassar } from "@/components/CarrosPraRepassar";
import { PageHeader } from "@/components/AppShell";

export default function RepassarPage() {
  return (
    <>
      <PageHeader
        title="Carros pra repassar"
        subtitle="Critérios: 10 anos ou mais de uso · 100.000 km ou mais · 50 dias parado ou mais"
      />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <CarrosPraRepassar />
      </div>
    </>
  );
}
