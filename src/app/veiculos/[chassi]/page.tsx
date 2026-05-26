import { VeiculoDetalhe } from "@/components/VeiculoDetalhe";

export default async function VeiculoDetailPage({ params }: { params: Promise<{ chassi: string }> }) {
  const { chassi } = await params;
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <VeiculoDetalhe chassi={chassi} />
      </div>
    </main>
  );
}
