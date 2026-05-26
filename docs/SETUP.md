# Setup — Navesa Mesa

Guia passo-a-passo para sair do scaffold local pra ambiente funcional com banco e deploy.

---

## 1. Pré-requisitos (já OK no seu setup)

- Node.js 22+ ✅
- npm ✅
- Git ✅

---

## 2. Rodar localmente sem Supabase (verificar scaffold)

```powershell
cd "C:\Users\Marcos Henrique\Desktop\Precificaçao\navesa-mesa"
npm run dev
```

Abre `http://localhost:3000`. As páginas `/upload`, `/veiculos`, `/lojas` mostram scaffolds.

---

## 3. Validar o parser do NBS (sem cloud, contra o XLSX real)

```powershell
npm run parse-test -- "C:\Users\Marcos Henrique\Documents\Mesa de Precificaçao\reee.xlsx"
```

Deve imprimir 680 veículos, 15 lojas, R$ 112M total.

---

## 4. Criar projeto Supabase

1. Vá em https://supabase.com → "New project"
2. Nome: `navesa-mesa` • Senha forte do banco (guarde) • Região mais próxima (São Paulo se disponível)
3. Aguarde ~2 min até o projeto subir
4. Em **Project Settings → API**, copie:
   - `Project URL` → vai em `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → vai em `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` (secreta) → vai em `SUPABASE_SERVICE_ROLE_KEY`
5. Em **SQL Editor → New query**, cole o conteúdo de `supabase/migrations/001_initial.sql` e clique Run

---

## 5. Configurar `.env.local`

```powershell
copy .env.local.example .env.local
# Abra .env.local no VS Code e preencha os valores reais
```

Importante: `.env.local` está no `.gitignore` — nunca vai pro GitHub.

---

## 6. Chave Anthropic (para Sprint 4 — IA)

1. https://console.anthropic.com → API Keys → Create Key
2. Cole em `ANTHROPIC_API_KEY` no `.env.local`

Pode pular agora se não vai mexer com IA no Sprint 1-3.

---

## 7. Subir pra GitHub

```powershell
cd "C:\Users\Marcos Henrique\Desktop\Precificaçao\navesa-mesa"
# Crie o repo no github.com primeiro (privado), depois:
git remote add origin https://github.com/SEU_USER/navesa-mesa.git
git branch -M main
git push -u origin main
```

---

## 8. Deploy Vercel

1. https://vercel.com → "Add New Project" → escolha o repo `navesa-mesa`
2. Framework: Next.js (detectado automaticamente)
3. **Environment Variables**: cole as 4 chaves (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`)
4. Deploy → recebe URL `https://navesa-mesa.vercel.app`

Daqui em diante, todo `git push` na branch `main` redeploya automaticamente.

---

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `npm run dev` quebra com erro do Supabase | env vars não preenchidas | Criar `.env.local` e reiniciar `npm run dev` |
| `parse-test` falha lendo XLSX | Caminho com acentos sem aspas | Sempre usar aspas duplas: `"C:\...\arquivo.xlsx"` |
| Deploy Vercel quebra no build | env var faltando | Confirmar todas no painel Vercel → Settings → Environment Variables |
| RLS bloqueia leituras | Não autenticou | Ainda vamos implementar auth no Sprint 2 — temporário |
