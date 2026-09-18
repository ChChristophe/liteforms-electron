# Fiche d'audit de portage — wake word « Hey Jarvis » (commits `Jarvis:`)

Règle applicable : `Liteforms-Mobile-Application/PLAN.md` §6.4/§6.5 — un commit
`Jarvis:` est une **entrée fonctionnelle à auditer**, jamais du code de référence
fiable. Cette fiche est la trace exigée (l'identité byte-à-byte avec la web n'est
pas, en soi, une preuve de propreté).

## Commits et fichiers Web inspectés

- Bundle wake word : `5086b76`, `a72535d`, `bc9d76e`, `351b034`, `f0e4ee9`,
  `2033482`, `bf81276` (`bundles/wakeword/**`, `public/models/wakeword/`,
  `public/ort/`, `public/worklets/`, `features.json`, `lib/core/featureFlags.ts`).
- Intégration : `components/chat/ChatPanel.tsx`, `components/avatar/AvatarScene.tsx`.
- Modules avatar : `95b2784` (#5 idle loop + foot plant → `idleChoreographer.ts`,
  `animationOptions.ts`, `vrmFootPlantLock.ts`, `vrmRuntimeAnimator.ts`),
  `2033482` (#16 cue → `lib/avatar/wakeWordCue.ts`).
- **Hors audit initial** (antérieurs à `4952eed`, retrouvés en revue) :
  `bbf7a74` (micro après saisie texte), `941f44b` (calibration subpixel non-Go).

## Comportement fonctionnel conservé

- Détection locale (`hey_jarvis`, `alexa`, `hey_mycroft`, `hey_rhasspy`), score,
  cooldown 2 s, seuil réglable.
- **Un seul** `getUserMedia` (stream partagé ChatPanel) ; mode exclusif (micro
  manuel désactivé tant qu'un wake word est armé).
- Détection → STT auto (`forceSentenceAutoSubmit`) ou session realtime ; gate
  `shouldTriggerVoiceSession` (repos uniquement).
- Fidgets d'idle (30–50 s) + cue (blink alcôve + animation de greeting).
- Persistance `liteforms.wakewordConfig` ; choix poussé par le Mobile
  (`device-config`, bloc `wakeWord`).

## APIs Web exclues / adaptées

- Le bundle est autonome : aucune dépendance à WebXR / Looking Glass.
- AudioWorklet servi en statique (`/worklets/pcm-worklet.js`) ; ORT self-hosté
  (`/ort/`, `onnxruntime-web/wasm`) ; `crossOriginIsolated` vrai côté Electron
  (COOP/COEP déjà en place) → artefacts threaded réutilisés (pas de single-thread).
- Contact avec le core limité au montage du bridge dans `ChatPanel` (dérogation
  documentée) et à l'écoute de l'événement dans `AvatarScene`.

## Risques identifiés et traitement

- **`any`/casts** : limités aux frontières ORT (`as unknown as`) car ORT 1.21
  n'expose pas ces types — documentés, pas de cast sur la logique métier.
- **Fuite micro si l'inférence échoue** (le statut passait en `error` mais le
  device restait ouvert) : **corrigé** — le contrôleur libère le microphone sur
  `fail()` et vide la file ; test ajouté.
- **`QueuedFrame`** (wrapper `{frame}` inutile) : **supprimé**, la file est un
  `Int16Array[]`.
- **`idleWeight`** : d'abord soupçonné de code mort, en fait **utilisé par les
  tests** → conservé (vérifié).
- **Extracteur audio** (`rawDataBuffer` en `number[]`, `slice` par frame) :
  inefficace mais fidèle à l'upstream, cadence 80 ms ; **limite connue**, pas de
  réécriture (algorithme validé).
- **`console.warn` (sample rate)** : conservé — le bundle reste volontairement
  sans dépendance au core (`logDiagnostic` vit côté Electron).
- **Mobile** : `flexWrap` inutile retiré des chips d'animation.

## Incidents (revue terrain)

- **La cue ne s'affichait jamais sur le Looking Glass.** Cause racine : le relais
  inter-fenêtres (`localStorage`) était publié **par l'AvatarScene**, or
  `app/page.tsx` démonte l'AvatarScene de la fenêtre principale dès que la
  fenêtre `/hologram` est active (`{!hologramActive && <AvatarScene/>}`) : le
  CustomEvent était émis dans une fenêtre sans écouteur et le relais ne partait
  jamais. **Correction** : le bridge (toujours monté) publie le relais ;
  l'AvatarScene ne fait plus que consommer. **Leçon** : un relais inter-fenêtres
  doit être publié par un composant **toujours monté**, jamais par une vue
  conditionnelle. Preuve : `cue dispatched+published` (bridge) puis
  `wake word cue | hologram=true` (hologramme).

## Choix d'implémentation

- Electron est la même plateforme (Next) → port quasi direct, contrairement au
  Mobile où la règle impose une réimplémentation native.
- Le choix du wake word est **la source de vérité du Mobile** ; l'appliance garde
  son UI locale ; bloc `wakeWord` absent = sélection locale conservée.
- Aperçu d'animation Mobile : purement local, **non persisté**.

## Décisions de validation et de persistance

- `device-config` transporte `wakeWord { model, cue? }` (protocole 18/09/2026) ;
  l'appliance applique au store, le bridge se ré-arme. `cue` (couleur du flash,
  durée, animation) est **facultatif** : absent = réglages locaux conservés,
  champ invalide = warning (jamais 400).
- **L'animation de cue se choisit exclusivement dans l'aperçu de l'avatar
  Mobile** (lecture à chaud + persistance) — décision produit ; l'écran Wake
  word ne porte que modèle, couleur et durée.
- Aucune donnée audio ne quitte l'appareil ; aucune clé dans le bundle.

## Tests ajoutés et tests manuels

- Bundle : registry, contrôleur (dont **échec d'inférence → micro libéré**),
  microphone, panneau POC.
- ChatPanel : gate wake word, propagation `forceSentenceAutoSubmit`,
  anti-relance (`!wakeWordArmed`), auto-relance **uniquement** sur entrée audio
  (web-parité `bbf7a74`).
- AvatarScene : cue + relais hologramme (`wakeWordCueTrigger`) ; calibration LKG.
- Manuel : détection validée ; fidgets + cue à confirmer sur LKG ; aperçu
  d'animation Mobile à confirmer sur appareil.

## Tranche 4 — cue, relais, robustesse (18/09/2026, validé terrain)

- **#5 `IdleChoreographer`** porté (fidgets 30–50 s, `playClipNow`) : il était
  classé « déjà présent » à tort. C'est la base du greeting de la cue.
- **#16 câblage `AvatarScene`** : `liteforms:wakeword-detected` → blink alcôve +
  animation. `lib/avatar/wakeWordCue.ts` (déjà porté) consommé.
- **Incident (cue invisible)** : le relais `localStorage` était publié par
  l'`AvatarScene`, démonté quand l'hologramme est actif (`app/page.tsx`). Le
  **bridge** publie désormais le relais (toujours monté). Test ajouté
  (`wakeWordChatBridge.arming.test.tsx`). **Leçon : relais depuis un composant
  toujours monté.**
- **Amélioration hors parité web** : timeout d'inactivité micro (8 s) sur une
  session **déclenchée par le wake word** → micro rendu si l'utilisateur ne
  parle pas. Micro manuel inchangé.
- **Correctifs de revue** : `bbf7a74` (micro relancé après un envoi texte),
  `941f44b` (calibration subpixel non-Go).

## Limites restantes

- `941f44b` visait les LFD **non-Go** (neutre sur la Looking Glass Go).
- Cue : la fenêtre principale joue en direct, la fenêtre `/hologram` rejoue via
  l'événement `storage` ; en fallback HLD l'alcôve est masquée → pas de flash
  (parité web), le greeting joue.
- Extracteur audio non optimisé (héritage upstream), assumé.
- Timeout d'inactivité micro : valeur fixe 8 s (pas encore réglable).
