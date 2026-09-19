# Audit de portage — session OpenClaw, borne TTS, vitesse TTS

Source : commits `Jarvis:` du repo Web (référence fonctionnelle), portage vers
Electron. Statut : implémenté, non commité (working tree).

## #19/#20 — Session OpenClaw réutilisée (conversation id stable)

- **Comportement à préserver** : pour `openclaw` uniquement, un id de
  conversation stable par montage du ChatPanel est envoyé comme `user`
  (`liteforms-<id>`) et **seul le dernier message `user`** est envoyé au
  gateway ; les autres providers gardent l'historique complet et ne reçoivent
  jamais `user`. Sans `conversationId`, OpenClaw reste stateless.
- **Contrat de données** : `ChatRequest.conversationId?: string` (champ JSON
  optionnel, rétro-compatible). Il traverse `ChatPanel → POST /api/llm/stream
  → createLlmAdapter` sans validation serveur restrictive (route = `await
  request.json()`).
- **Divergence Electron** : le renderer localhost route OpenClaw via le proxy
  Next ; `streamViaProxy` sérialise la requête entière → le champ traverse.
  Côté serveur, `createLlmAdapter({ fetch: globalThis.fetch })` prend la branche
  `streamOpenAiCompatible` directe, qui applique la session. Hors localhost, le
  renderer applique la session directement. Aucun chemin en double.
- **Tests ajoutés** (parité Web, 3 cas) : `lib/llm/adapters.test.ts` —
  session réutilisée (`user` + dernier message user seul), OpenClaw stateless
  sans id, `user` jamais envoyé pour un provider stateless même avec un id.
- **Smells** : pas de `any`, pas d'API Node côté renderer ; `crypto.randomUUID`
  du renderer Chromium avec fallback `conv-<ts>-<rand>`.

## #21 — Borne de synthèses TTS concurrentes (max 2)

- **Comportement à préserver** : au plus `TTS_MAX_CONCURRENT_SYNTH = 2`
  `synthesize` en vol, stream LLM non bloqué, ordre de lecture conservé, drain
  idle jusqu'au `streamDone`.
- **Implémentation** : `TTS_MAX_CONCURRENT_SYNTH` + `BoundedSchedulerState` +
  `runBounded` identiques au Web ; `synthQueue.push(runBounded(() =>
  ttsAdapter.synthesize(prepared), ttsScheduler))`. Le pipeline Electron diverge
  (hook `handleTtsForHologram`) mais l'invariant est inchangé. La constante
  porte désormais son **justification** (pourquoi 2 : lancer les premières
  phrases pendant que le LLM streame encore, sans saturer le provider/worker) —
  aucun changement de comportement.
- **Tests ajoutés** (`components/chat/ChatPanel.test.tsx`) :
  1. borne : jamais plus de 2 en vol, 3e synthese démarre seulement après
     libération d'un slot, ordre du buffer respecté (One/Two/Three/Four) ;
  2. cas d'erreur : un rejet libère son slot, la synthèse suivante démarre et
     l'erreur remonte via `speechError` (inchangé) ;
  3. **cycle de vie/cleanup** (19/09) : à la fin du stream, le drain se termine
     sans synthèse fantôme et le tour suivant repart d'un scheduler neuf ;
     après un **abort d'erreur** du stream LLM, les synthèses en attente sont
     abandonnées (`ttsScheduler.aborted` + purge `pending`) et ne redémarrent
     jamais quand un slot se libère.
- **Smells** : pas de fuite de promesse (`.finally` décrémente et relance le
  pending) ; pas de `any` ; `BoundedSchedulerState.aborted` empêche toute
  synthèse fantôme après un échec de tour.

## #4 — Vitesse de la voix (pilotée par le Mobile via le contrat, 19/09/2026)

- **Décision produit (source de vérité)** : **la vitesse suit la voix réellement
  utilisée**.
  - La voix vient du **provider TTS** → la vitesse voyage dans
    `providers.tts.speed`.
  - `providers.llm.provider` est **realtime** → la voix est celle du LLM
    (`providers.llm.voiceId`), la vitesse voyage dans `providers.llm.speed` et
    `providers.tts.speed` est sans objet.
- **Plage par provider** (contrat `protocol/DEVICE_API.md` §Bloc
  `providers.llm.speed` / `providers.tts.speed`) :
  - `tts.speed` : `openai` `[0.25, 4]`, `elevenlabs` `[0.7, 1.2]` ; tout autre
    provider → champ **ignoré** + warning `providers.tts.speed ignored` ;
  - `llm.speed` : `openai-realtime` `[0.25, 1.5]` uniquement ; `google-live`
    (Gemini Live n'expose pas de vitesse) et les llm non-realtime → **ignoré** +
    warning `providers.llm.speed ignored` ;
  - `stt` : **jamais de `speed`** (champ étranger, silencieusement retiré).
- **Le téléphone prend la main** : chaque `POST /api/device-config` remplace le
  réglage local ; `null`/absent = défaut du provider. Le champ desktop
  (`OnboardingModal`) reste un **défaut écrasé à chaque push** — comportement
  voulu, pas une régression.
- **Validation appareil** (`lib/deviceConfig/pocConfig.ts`, miroir de
  `parseAvatarPose`) : chaque slot est reconstruit ; `TTS_SPEED_RANGES` (par
  provider) et `LLM_SPEED_RANGE` (`openai-realtime`) portent les bornes ;
  nombre fini dans la plage → conservé ; `null`/absent → pas de vitesse ; sinon
  ignoré avec le warning protocolaire, **jamais un 400**.
- **Mapping** (`lib/deviceConfig/pocClient.ts`) : `providers.tts.speed` →
  `TtsConfig.speed` (chemin `openai` de `lib/speech/tts.ts` : `speed` dans
  `POST /audio/speech`) ; `providers.llm.speed` (openai-realtime) →
  `realtimeVoice.speed`, envoyé dans `session.audio.output.speed` par
  `buildOpenAiRealtimeSessionUpdateMessage` **seulement quand défini** (aucun
  `speed` par défaut). `google-live` n'a pas de champ vitesse
  (`normalizeGoogleLiveVoiceConfig` inchangé).
- **État Electron vérifié avant portage** : `lib/speech/config.ts`,
  `lib/speech/tts.ts` et `lib/speech/types.ts` portaient **déjà** la
  propagation (`openai` : `speed` envoyé seulement si configuré ; MiniMax :
  speed/vol/pitch). Seul l'écran d'onboarding manquait.
- **Implémentation desktop** : `getTtsSpeed`/`setTtsSpeed` (`Number.isFinite`
  garde) + champ numérique `Speed (0.25 - 4)` affiché uniquement pour `openai`,
  identiques au Web (`OnboardingModal.tsx`). Persisté par `handleUseCustom` →
  `saveSessionConfig`.
- **Tests ajoutés** :
  - `OnboardingModal.test.tsx` : défaut 1 ; le champ vitesse TTS n'est affiché
    que pour OpenAI ; le champ vitesse realtime n'est affiché que pour
    `openai-realtime` (absent pour `google-live`) ; édition non finie ignorée ;
    propagation `tts.speed` / `realtimeVoice.speed` jusqu'à `onUseCustom` ;
  - `pocConfig.test.ts` : `tts.speed` valide conservée (bornes incluses) ; hors
    bornes / non finie / non numérique ignorée + warning ; `null`/absent ;
    **plage elevenlabs `[0.7, 1.2]`** ; provider TTS sans plage ignoré +
    warning ; `llm.speed` `openai-realtime` valide (bornes incluses) ;
    hors plage/type ignoré + warning `providers.llm.speed ignored` ;
    `google-live`/non-realtime ignoré + warning ; `stt` jamais de `speed` ;
  - `pocClient.test.ts` : mapping `tts.speed` ; un push `speed: null` ne pose
    aucune vitesse ; mapping `llm.speed` → `realtimeVoice.speed` pour
    `openai-realtime` ; `speed: null` → pas de `realtimeVoice.speed` ; hors
    plage → warning + pas de `speed` ;
  - `openAiRealtime.test.ts` : `session.update` porte
    `audio.output.speed` quand configuré, et **pas** de champ `speed` sinon.
- **Fichiers touchés (feature vitesse)** : `lib/deviceConfig/pocConfig.ts`,
  `lib/deviceConfig/pocClient.ts`, `lib/speech/openAiRealtime.ts`,
  `components/onboarding/OnboardingModal.tsx` (+ tests associés),
  `components/chat/ChatPanel.tsx` (#2/#21),
  `components/chat/ChatPanel.test.tsx` (#21).


## Vérifications

`npm test` 104 fichiers / 1144 passés, 58 skip ; `npm run lint` 0 erreur,
22 warnings préexistants ; `npx tsc --noEmit` sans sortie ;
`npm run build:electron:main` OK.
