export default function UploadPage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <a href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← voltar</a>
        <h1 className="mt-4 text-2xl font-bold">📤 Upload de relatório NBS</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Sprint 1 — em construção. O componente de drag-and-drop + Server Action de ingestão entram aqui.
        </p>
        <div className="mt-6 rounded-lg border-2 border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-zinc-500">Arraste o XLSX do NBS aqui (a implementar)</p>
        </div>
      </div>
    </main>
  );
}
