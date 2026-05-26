export default function LojasPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <a href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← voltar</a>
        <h1 className="mt-4 text-2xl font-bold">🏢 Cadastro de lojas</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Sprint 2 — CRUD pra mapear códigos das filiais para nomes legíveis.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li>• Loja 2 — NAVESA FORD AEROPORTO (já confirmada)</li>
          <li>• 14 outras: 9, 26, 29, 31, 32, 35, 52, 54, 71, 82, 86, 87, 89, 91</li>
        </ul>
      </div>
    </main>
  );
}
