# Sync to Google Docs on PR Merge

[![Tests](https://github.com/leo-prange-vtex/sync-sheets-on-pr-merge/actions/workflows/example.yml/badge.svg)](https://github.com/leo-prange-vtex/sync-sheets-on-pr-merge/actions)

Uma GitHub Action que automatiza a sincronização de arquivos com o Google Docs quando um Pull Request é mergeado em uma pasta configurada.

## 📋 Índice

- [Objetivo](#objetivo)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Uso](#uso)
- [Inputs](#inputs)
- [Exemplos](#exemplos)
- [Testes](#testes)
- [Troubleshooting](#troubleshooting)
- [Licença](#licença)

## 🎯 Objetivo

Manter documentação sincronizada automaticamente: quando documentos são atualizados em um repositório GitHub (ex: PRDs, especificações, etc), esta action envia o conteúdo atualizado para um Google Doc pré-configurado, eliminando a necessidade de sincronização manual.

**Caso de uso ideal:** Equipes que mantêm PRDs e documentação técnica no GitHub e precisam espelhá-la em tempo real no Google Docs para colaboração.

## ✨ Funcionalidades

- ✅ Detecta automaticamente PRs mergeados
- ✅ Filtra apenas arquivos de uma pasta específica
- ✅ Lê o conteúdo dos arquivos modificados
- ✅ Sincroniza para Google Docs via API oficial
- ✅ Autenticação com Service Account (segura)
- ✅ Tratamento robusto de erros
- ✅ Logging detalhado das operações
- ✅ Suporte a múltiplos arquivos por PR

## 🏗️ Arquitetura

### Componentes Principais

```
┌─────────────────────────────────────────────────────────┐
│          GitHub Event (Pull Request Merged)             │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  index.js (Action Logic)                                │
│  - Valida event e contexto                              │
│  - Filtra arquivos por pasta                            │
│  - Lê conteúdo dos arquivos                             │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Service Account Auth (GoogleAuth)                      │
│  - Autenticação segura com credenciais                  │
│  - Escopo: https://www.googleapis.com/auth/documents   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Google Docs API Client                                 │
│  - Busca documento existente                            │
│  - Deleta conteúdo antigo                               │
│  - Insere novo conteúdo formatado                       │
│  - Confirma atualização                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│            Google Docs (Atualizado)                     │
└─────────────────────────────────────────────────────────┘
```

### Stack Tecnológico

| Componente | Versão | Propósito |
|-----------|--------|----------|
| Node.js | 20+ | Runtime |
| @actions/core | ^1.10.0 | API do GitHub Actions |
| @actions/github | ^5.0.0 | Context e Octokit |
| googleapis | ^121.0.0 | Google Docs API |
| jest | ^29.0.0 | Testes unitários |

## 📋 Pré-requisitos

1. **Google Cloud Project** com:
   - Google Docs API habilitada
   - Service Account criada
   - Chave privada em JSON

2. **Google Doc** compartilhado com o email da Service Account

3. **GitHub Repository** com:
   - Pasta contendo arquivos a sincronizar (ex: `docs/prds/`)
   - Permissões para adicionar Secrets

## 🔧 Instalação

### Opção 1: Usar diretamente do repositório

```yaml
- uses: leo-prange-vtex/sync-sheets-on-pr-merge@v1
```

### Opção 2: Compilar localmente

```bash
# Clone o repositório
git clone https://github.com/leo-prange-vtex/sync-sheets-on-pr-merge.git
cd sync-sheets-on-pr-merge

# Instale as dependências
npm install

# Execute os testes
npm test
```

## ⚙️ Configuração

### 1. Criar Service Account no Google Cloud

```bash
# Acesse Google Cloud Console
# 1. Vá para "Service Accounts"
# 2. Crie uma nova Service Account
# 3. Gere uma chave JSON
# 4. Download a chave
```

### 2. Compartilhar Google Doc

```
1. Abra o Google Doc que deseja sincronizar
2. Compartilhe com o email da Service Account
3. Conceda permissão de "Editor"
4. Copie o ID do documento da URL: 
   https://docs.google.com/document/d/{DOCUMENT_ID}/edit
```

### 3. Adicionar Secrets no GitHub

No repositório, vá para **Settings → Secrets and variables → Actions**:

```
GOOGLE_SERVICE_ACCOUNT    → Cole o conteúdo da chave JSON
GOOGLE_DOC_ID              → Cole o ID do documento
```

## 🚀 Uso

### Workflow Básico

Crie ou edite `.github/workflows/sync-docs.yml`:

```yaml
name: Sync PRDs on Merge

on:
  pull_request:
    types: [closed]
    paths:
      - 'docs/prds/**'

jobs:
  sync_docs:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Sync to Google Docs
        uses: leo-prange-vtex/sync-sheets-on-pr-merge@v1
        with:
          folder_path: "docs/prds"
          google_service_account: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
          google_doc_id: ${{ secrets.GOOGLE_DOC_ID }}
```

### Workflow Avançado (com notificação)

```yaml
name: Sync with Notification

on:
  pull_request:
    types: [closed]

jobs:
  sync_and_notify:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4

      - uses: leo-prange-vtex/sync-sheets-on-pr-merge@v1
        with:
          folder_path: "docs/prds"
          google_service_account: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
          google_doc_id: ${{ secrets.GOOGLE_DOC_ID }}
        id: sync

      - name: Comment on PR
        if: success()
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '✅ Documentação sincronizada com Google Docs!'
            })

      - name: Notify on Failure
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ Falha ao sincronizar documentação. Verifique os logs.'
            })
```

## 📥 Inputs

| Input | Obrigatório | Descrição | Exemplo |
|-------|------------|-----------|----------|
| `folder_path` | ✅ | Caminho da pasta a monitorar (relativo à raiz do repo) | `docs/prds` |
| `google_service_account` | ✅ | JSON da Service Account (armazenado em Secrets) | `${{ secrets.GOOGLE_SERVICE_ACCOUNT }}` |
| `google_doc_id` | ✅ | ID do Google Doc para sincronização | `1a2b3c4d5e6f...` |

## 📚 Exemplos

### Exemplo 1: Sincronizar PRDs

```yaml
- name: Sync PRDs
  uses: leo-prange-vtex/sync-sheets-on-pr-merge@v1
  with:
    folder_path: "docs/prds"
    google_service_account: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
    google_doc_id: ${{ secrets.PRD_DOC_ID }}
```

### Exemplo 2: Sincronizar Especificações Técnicas

```yaml
- name: Sync Tech Specs
  uses: leo-prange-vtex/sync-sheets-on-pr-merge@v1
  with:
    folder_path: "docs/specs"
    google_service_account: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
    google_doc_id: ${{ secrets.SPECS_DOC_ID }}
```

### Exemplo 3: Múltiplas sincronizações no mesmo workflow

```yaml
jobs:
  sync_all_docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Sync PRDs
        uses: leo-prange-vtex/sync-sheets-on-pr-merge@v1
        with:
          folder_path: "docs/prds"
          google_service_account: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
          google_doc_id: ${{ secrets.PRD_DOC_ID }}

      - name: Sync Specs
        uses: leo-prange-vtex/sync-sheets-on-pr-merge@v1
        with:
          folder_path: "docs/specs"
          google_service_account: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
          google_doc_id: ${{ secrets.SPECS_DOC_ID }}

      - name: Sync Guides
        uses: leo-prange-vtex/sync-sheets-on-pr-merge@v1
        with:
          folder_path: "docs/guides"
          google_service_account: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
          google_doc_id: ${{ secrets.GUIDES_DOC_ID }}
```

## 🧪 Testes

### Executar testes localmente

```bash
# Instale as dependências
npm install

# Execute os testes
npm test

# Com watch mode
npm run test:watch

# Com coverage
npm test -- --coverage
```

### Cobertura de testes

A suite de testes cobre os seguintes cenários:

- ✅ Validação de evento (PR event obrigatório)
- ✅ Verificação de merge (apenas PRs mergeados)
- ✅ Filtragem de arquivos (apenas da pasta configurada)
- ✅ Autenticação (Service Account)
- ✅ Leitura de arquivos (sucesso e falha)
- ✅ Sincronização com Google Docs
- ✅ Tratamento de erros da API
- ✅ Formatação de conteúdo
- ✅ Parse de credenciais JSON
- ✅ Suporte a múltiplos arquivos

**Resultado:** 10/10 testes passando ✅

## 🔍 Troubleshooting

### Erro: "This action should be triggered by a pull_request event"

**Causa:** Workflow não está configurado para `pull_request` event.

**Solução:**
```yaml
on:
  pull_request:
    types: [closed]  # ← Necessário!
```

### Erro: "Pull request not merged; skipping"

**Causa:** Action foi acionada por PR fechado, mas não mergeado.

**Solução:**
```yaml
jobs:
  sync:
    if: github.event.pull_request.merged == true  # ← Adicionar verificação
```

### Erro: "Invalid Google credentials"

**Causa:** Service Account JSON inválida ou expirada.

**Solução:**
1. Vá para Google Cloud Console
2. Regenere a chave da Service Account
3. Atualize o Secret no GitHub

### Erro: "Google Doc not found"

**Causa:** Document ID incorreto ou document não compartilhado.

**Solução:**
1. Copie exatamente o ID da URL do documento
2. Compartilhe o document com o email da Service Account
3. Conceda permissão de "Editor"

### Ação não está sincronizando

**Debug:**
1. Verifique se a pasta monitorada existe
2. Verifique se há arquivos nela
3. Verifique os logs da action no GitHub

```bash
# Ver logs
GitHub → Actions → [Seu Workflow] → [Seu Job] → Sync to Google Docs
```

## 📊 Comportamento

### Fluxo de execução

1. **Trigger:** PR mergeado contendo mudanças
2. **Validação:** Verifica se é pull_request event e se foi mergeado
3. **Filtragem:** Identifica arquivos na pasta configurada
4. **Autenticação:** Conecta-se ao Google Docs API
5. **Sincronização:** 
   - Busca documento existente
   - Remove conteúdo antigo
   - Insere novo conteúdo formatado
6. **Notificação:** Log de sucesso/falha

### Formato do conteúdo sincronizado

```
Synced files from owner/repo PR #42

=== docs/prds/prd-001.md ===
[Conteúdo do arquivo]

=== docs/prds/prd-002.md ===
[Conteúdo do arquivo]
```

## 🚨 Limitações conhecidas

- A action sincroniza o **conteúdo bruto** dos arquivos (não converte markdown)
- Google Docs não mantém histórico de versões anteriores (sobrescreve conteúdo)
- Arquivos grandes (>10MB) podem ter timeout
- Máximo de 10 operações por minuto na Google Docs API

## 🔐 Segurança

- ✅ Credenciais armazenadas em GitHub Secrets
- ✅ Service Account sem permissão de Admin
- ✅ Escopo restrito apenas para documentos
- ✅ Não armazena credenciais em logs
- ✅ Validação de entrada

## 📝 Licença

MIT

## 🤝 Contribuindo

Contribuições são bem-vindas! Para reportar bugs ou sugerir features:

1. Abra uma [Issue](https://github.com/leo-prange-vtex/sync-sheets-on-pr-merge/issues)
2. Descreva o problema ou sugestão
3. Inclua exemplos se possível

## 📞 Suporte

Para dúvidas, abra uma discussão ou issue no repositório.
