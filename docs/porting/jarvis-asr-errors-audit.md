# Audit de portage — erreurs STT + modèle diarize (#2, commit Web `985278b`)

Source : commit `Jarvis : Update provider + Error système` `985278b` du repo Web
(référence fonctionnelle). Rôle : **auditer**, pas copier. Statut : implémenté,
non commité (working tree Electron).

## Commit et fichiers Web inspectés

- `985278b` — 4 fichiers : `lib/speech/asr.ts`, `lib/speech/providerOptions.ts`,
  `lib/speech/asr.test.ts`, `lib/llm/providerOptions.ts` (2 modèles realtime).
- Néighbouring Electron relus : `lib/speech/asr.ts`, `lib/speech/config.ts`,
  `lib/speech/types.ts`, `lib/speech/asr.test.ts`,
  `lib/speech/providerOptions.ts`, `lib/llm/providerOptions.ts`.
- Callers de `createAsrAdapter` vérifiés : `components/chat/ChatPanel.tsx`
  (chemin provider), aucun autre appelant modifié.

## Comportement fonctionnel conservé

1. **`describeHttpError(response)`** : lit le corps JSON `{error:{message}}` et
   rend `` `${status}: ${message}` `` ; corps non-JSON ou champ absent → status
   seul. Remplace les messages tronqués `` `... failed with ${status}` `` dans
   **deepgram, elevenlabs, openai-compatible, xai**. L'utilisateur voit
   désormais la cause API réelle (ex. 403 « organization must be verified »).
2. **`gpt-4o-transcribe-diarize`** (`transcribeOpenAiCompatible`) : ce modèle
   rejette `prompt` et `language` → ils ne sont **pas** envoyés ; ajout de
   `chunking_strategy=auto` (nécessaire pour les entrées > 30 s). Condition
   `config.model.startsWith("gpt-4o-transcribe-diarize")` — couvre le préfixe
   sans figer un id exact. Aucun impact sur `mistral` (modèle différent).
3. **Options de modèles déjà présentes côté Electron** (vérifié, non reporté) :
   - #4 : `lib/llm/providerOptions.ts` porte déjà `gpt-realtime-2.1`,
     `gpt-realtime-2.1-mini`, `gpt-realtime-2`, `gpt-realtime` ;
   - #2 : `lib/speech/providerOptions.ts` porte déjà `gpt-transcribe`,
     `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize`,
     `whisper-1`.

## APIs/briques Web exclues

- Aucune API navigateur nouvelle (le code utilise `FormData`, `fetch`,
  `response.json()` — déjà présents et disponibles côté renderer Electron).
- Aucun changement de contrat réseau : mêmes endpoints, mêmes champs de
  formulaire hors `chunking_strategy`.

## Risques identifiés / smells

- `response.json()` peut lever sur un corps vide/non-JSON : enveloppé dans un
  `try/catch` → retombe sur le status seul (pas d'erreur masquée par un throw
  secondaire).
- `config.model` : le paramètre est typé `string` (non optionnel) → `startsWith`
  sûr ; pas de `any`.
- Aucun secret loggé (message d'erreur = message API du provider, jamais la clé).

## Choix d'implémentation

- Port fidèle du helper et de la condition diarize, adapté à la signature
  locale de `transcribeOpenAiCompatible` (identique au Web pré-commit).
- Aucune factorisation supplémentaire : `describeHttpError` reste privée au
  module, appelée par les 4 adaptateurs HTTP.

## Tests ajoutés (`lib/speech/asr.test.ts`)

1. **Erreur API remontée** : OpenAI STT renvoie 403
   `{error:{message:"Your organization must be verified…"}}` →
   `STT provider failed (403: …)`.
2. **Cas nominal diarize** : `gpt-4o-transcribe-diarize` envoie
   `chunking_strategy=auto` et **omet** `prompt`/`language` ; la requête reste
   résolue.
3. **Erreur non-JSON** : corps texte + 502 → message = `STT provider failed
   (502)` (status seul).

## Décisions de validation et persistance

- Aucun état persisté par ce correctif (purement messages + champs de requête).
- Validation par tests unitaires (aucun accès provider réel : clés absentes).

## Limites restantes

- `describeHttpError` ne lit que la forme OpenAI `{error:{message}}` ; un
  provider avec un autre schéma retombe sur le status seul (comportement
  dégradé volontaire, jamais un throw).
- Aucune validation terrain provider réelle (pas de clé API) — comportement
  couvert par tests avec `fetch` mocké.
