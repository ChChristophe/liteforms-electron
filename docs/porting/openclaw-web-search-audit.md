# Fiche d'audit — portage `openclaw_web_search` (web `28cc967` → Electron)

Règle applicable : `Liteforms-Mobile-Application/PLAN.md` §6.4/§6.5 — toute
reprise laisse une trace d'audit. Le web portait l'outil de recherche temps réel
dans ses deux adaptateurs realtime ; Electron l'avait **volontairement exclu**
(`lib/llm/toolCatalogue.ts`, `lib/llm/toolRegistry.ts`) faute de route et de
token. Le token local du gateway OpenClaw étant désormais résolu au boot
(`electron/openclaw/gatewayToken.ts`, commit `7663f48`, persisté dans
`provider-credentials.json` clé `openclaw`), l'outil est porté.

## Fichiers touchés

- `lib/llm/toolCatalogue.ts` — définition `openclaw_web_search` (description +
  `query` requis) et ligne d'instruction ; commentaire d'en-tête corrigé.
- `app/api/functions/openclaw_web_search/route.ts` — nouvelle route POST.
- `lib/llm/toolRegistry.ts` — `searchWeb?` injectable + `searchOpenClawWeb` +
  `case "openclaw_web_search"`.
- `components/chat/ChatPanel.tsx` — instanciation du registre avec le token du
  store de credentials (`resolveProviderCredential("openclaw")`).
- Tests : `lib/llm/toolCatalogue.test.ts`, `lib/llm/toolRegistry.test.ts`,
  `lib/speech/googleLive.test.ts`, `lib/speech/openAiRealtime.test.ts`,
  `components/chat/ChatPanel.test.tsx` (mock), nouvelle
  `app/api/functions/openclaw_web_search/route.test.ts`.

## Comportement utilisateur à préserver / contrat de données

- Le modèle appelle `openclaw_web_search({ query })` sur toute question
  factuelle temps réel (météo, actus, prix, sport…), jamais de mémoire.
- Requête gateway identique au web : `POST http://127.0.0.1:18789/v1/chat/completions`,
  modèle `openclaw/default`, message
  `Search the web for: <query>\n\nAnswer concisely based on what you find. Use web_search and web_fetch tools.`,
  `user: "liteforms-realtime-voice"`, `stream: false`.
- Réponse route : `{ answer }` en succès ; `400 { error: "Missing query" }` sans
  query ; `502 { error }` sur échec gateway/réseau. Le handler affiche
  `answer ?? error ?? "No result from OpenClaw."` (parité web).
- Le registre renvoie au modèle la chaîne formatée ; une erreur (dép qui jette,
  JSON illisible, query absente) donne le message générique
  `"Error executing function"`, jamais de throw.

## Ce que les tests existants ne couvraient pas

- `toolCatalogue.test.ts` asservissait l'**absence** de l'outil (l.19-21) ;
  `googleLive.test.ts` (l.181) et `openAiRealtime.test.ts` (l.176) aussi.
- Aucun test du registre pour un outil réseau, aucun test de route OpenClaw.

## Smells chassés

- **`if/else` géant du web** (`ChatPanel` ~l.953) : non recopié. Electron garde
  sa source unique (catalogue + registre) ; l'outil est un `case` de plus.
- **Token dans les logs** : la route ne logge pas ; le registre ne logge pas la
  requête (le `ChatPanel` logge déjà `args` = query seule, jamais le token).
- **Appel réseau au chargement** : la dépendance est paresseuse ; test dédié
  (`does not touch the network when the registry is built`).
- **Réseau non testable** : `searchWeb` injecté ; les tests n'utilisent que des
  stubs, aucun token réel.
- **Copie d'endpoint** : base configurable par `OPENCLAW_BASE_URL`, défaut
  identique au web.

## Divergences assumées vs web

- Le web lit le token depuis `body.token` puis `OPENCLAW_GATEWAY_TOKEN`. Electron
  privilégie le **store durable** (`LITEFORMS_CREDENTIALS_PATH`, clé `openclaw`,
  source de vérité écrite par le main process au boot), puis `body.token`, puis
  l'env — le renderer peut donc fournir le token en secours, sans qu'il soit
  loggué.
- Le web duplique les définitions par provider ; Electron les mappe depuis le
  catalogue unique (`adapters.ts` / `googleLive` / `openAiRealtime`), donc
  l'ajout au catalogue suffit à alimenter les deux adaptateurs.
- `fetch` indisponible (test/SSR) → le `try/catch` du registre rend le message
  générique, comme le `onFunctionCall` web.

## Décisions

- Préférence **store > body.token > env** (le secret reste local ; l'env et le
  body ne sont que des replis de parité).
- Aucune modification du protocole partagé (`protocol/DEVICE_API.md`) : la route
  est interne à l'appliance (renderer ↔ serveur Next local), pas une route
  Mobile.
- L'endpoint gateway reste `127.0.0.1:18789/v1` par défaut ; `OPENCLAW_BASE_URL`
  permet de le déplacer sans toucher au code.

## Limites

- La route suppose le gateway OpenClaw local joignable ; sinon 502 et le modèle
  reçoit le message d'erreur (pas de repli vers un autre fournisseur).
- `OPENCLAW_BASE_URL` n'est pas encore documenté dans le contrat mobile (route
  non exposée au LAN) ; réglage dev/appliance uniquement.
- Validation terrain (question météo réelle via la voix) à faire avec un gateway
  OpenClaw actif.

## Validation

- `npx vitest run` ciblé : 6 fichiers, 127 tests verts (catalogue, registre,
  route, googleLive, openAiRealtime, ChatPanel).
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build:electron:main` :
  voir le rapport de session (aucun commit, arbre de travail laissé modifié).
