# PLAN DIRECTEUR — Liteforms, l'appliance à hologramme (Mini-PC + Looking Glass)

> Document de travail unique, issu de l'échange complet. Il sert de **base de référence** pour toute la suite du projet.
> Dernière mise à jour : 13/09/2026 — **provisioning WiFi validé terrain de bout en bout sur Windows** (§5bis),
> blindage Linux transposé, onboarding mobile « zéro IP » défini (§5ter). Voir aussi §10 (post-mortem provisioning).

---

## 0. ÉTAT AU 13/09/2026 — où on en est, où on va (à lire en premier)

**Ce qui est terminé et validé terrain :**
- **Phase 2 (POC config Mobile → live)** : validée 12/09 (POC.md §13) — health, device-config, apply à chaud, swap VRM sur le Looking Glass.
- **Persistance durable device-config** + promotion des routes device (fin des canaux POC).
- **Provisioning WiFi contrat v1, cycle complet validé sur Windows le 13/09** (§5bis) :
  hotspot `Liteforms-Setup-XXXX` (2,4 GHz forcé) → Mobile envoie SSID/mot de passe →
  persistance safeStorage → arrêt hotspot → **join WiFi maison réussi (retry 0/3/6 s)** →
  relaunch attend la fin de la transition → boot normal `networkMode:"wifi"`.
  Routes provisioning actives UNIQUEMENT en mode provisioning ; `GET /api/health` servi
  aussi par le serveur de provisioning pendant ce mode (fix terrain).
- **Pare-feu automatisé** : règles NSIS à l'installation (8080 + 43178) ; win-unpacked
  logge l'instruction netsh exacte au lieu d'échouer silencieusement.
- **Linux blindé par transposition des leçons Windows** (commit `5f8511a`) : bande bg
  forcée, pin `192.168.4.1/24` + détection IP réelle (bug corrigé : `nmcli shared` donne
  `10.42.0.1` par défaut), vérification post-hotspot, retry join, polkit `resources/linux/`
  pour l'image dorée, ufw. **Checklist terrain Linux** : §5bis.4 — à exécuter au week-end Phase 1.

**Le chantier en cours (décidé 13/09) — onboarding mobile « zéro IP » (§5ter) :**
l'utilisateur lambda ne saisit JAMAIS d'IP/port. Flow : écran « rejoignez le réseau
Liteforms » → écran « votre WiFi » → écran « connexion en cours/vérification » →
directement les écrans de configuration (VRM, personnalité…). La saisie IP/port devient
un écran « Paramètres → Connexion avancée » (dev/debug). Découverte post-provisioning et
reconnexion automatique par **scan de sous-réseau + matching `deviceId`** (mDNS en
optimisation ultérieure, quand builds EAS). Re-provisioning automatique au boot si le
join échoue (l'appliance redevient trouvable). Patterns industriels de référence :
Chromecast/Echo (hotspot temporaire), Sonos (découverte mDNS), recovery par bouton (§6.7).

**Ensuite (ordre) :** portage web→Electron Phase 0 (groupe mood/pose prioritaire — ferme
les warnings du contrat mobile), Phase 1 Linux sur le terrain, Phase 3 (autostart,
mDNS, pairing), Phase 4 (sécurité durcie).

---

## 0. Vision produit

Liteforms devient une **appliance** :

- un **Mini-PC Linux** branché → l'app Electron **démarre toute seule** ;
- un **Looking Glass** affiche l'avatar holographique (Clawdia) avec **lip-sync** piloté par la voix (TTS + voix temps réel) ;
- **aucun écran/UI nécessaire au quotidien** : l'app **mobile** est la source de vérité pour toute la configuration ;
- le téléphone provisionne le Mini-PC (Wi-Fi maison), le couple (devise_id/secret) puis pousse les réglages **en direct** (sans redémarrer) : modèles LLM/TTS/ASR, wake word, couleur de l'alcove, émotion, choix du VRM, etc.

Cette vision implique **3 chantiers imbriqués** :
1. **le portage web → Electron** du travail fait dans le repo web (31 commits `Jarvis:`) ;
2. **l'app mobile** (UI de configuration + provisioning) — projet séparé ;
3. **le kiosque Linux** (autostart, Wi-Fi, appairage, mise à jour auto).

Ce document couvre l'ensemble, avec états, difficultés, risques, chiffres et phasage.

---

## 1. Contexte technique (repos, environnement, validation)

### 1.1 Repos

| Repo | Rôle | Origine | État actuel |
|---|---|---|---|
| `C:\dev\liteforms-web` | Repo « web » : **31 commits `Jarvis:`** à porter | origine GitHub (ChChristophe) | HEAD = `9fc237f` (calcul realtime) |
| `C:\dev\liteforms-electron` | **Workspace de dev** (travail non commité : holo, systray, port alcove…) | origin `Looking-Glass/liteforms-web` | working tree divergent, **rien commité** |
| `C:\dev\electron\liteforms-electron` | **Fork privé / base de travail** (6 commits `Jarvis:` créés localement, **jamais poussés**) | `git@github.com:ChChristophe/liteforms-electron.git` | HEAD `52dcd05` + 6 commits locaux ; working tree propre |

**Topologie git** : ancêtre commun `7fa7670`. Puis :
- côté Electron : `5fdad0c` (fix calibration bridge) → `4dbecb1` (build ouvre une fenêtre) → `52dcd05` (fullscreen + suppression d'UI) ;
- côté web : les **31 commits `Jarvis:`** (dont l'ancêtre des deux côtés a divergé).

### 1.2 Environnement de travail

- OS : **Windows 10/11 (build 26200)**, shell PowerShell 5.1.
- Node `npm`, **electron-builder 26.8.1**, **Electron 41.7.1**, Next.js **standalone**.
- Scripts utiles (dans la paire de repos) :
  - `npm run build:electron` = `build:electron:main` (`tsc -p electron/tsconfig.json`) + `build:electron:next` (`next build` en mode `LITEFORMS_ELECTRON_BUILD=1` + `scripts/prepare-electron-next.mjs`) ;
  - `npm run dist:electron` = build + `electron-builder --config electron-builder.config.cjs` ;
  - `npm test` = `vitest run` ; `npm run lint` = `eslint .` ;
  - typecheck complet = `npx tsc --noEmit`.

### 1.3 Ce qui est déjà validé

- **Fenêtre `/hologram`** dédiée au Looking Glass : lip-sync stable via RMS, TTS + voix temps réel relayés depuis la fenêtre principale par `postMessage`, minimisation → **systray avec logo**.
- **Build Windows fonctionnel** : `release\win-unpacked\Liteforms.exe` + installateur NSIS ; ressources vérifiées : `resources\next\standalone\server.js` (fix standalone), `resources\bridge\win32-x64` (bridge natif), icônes dans l'asar.
- **Tests** : 22/22 verts pour `environmentLoader` + `environmentConfig` ; eslint propre sur les fichiers portés ; `tsc --noEmit` sans erreur sur les fichiers du port (erreurs **pré-existantes** non liées dans `electron/electronBuild.test.ts`, `lib/avatar/nativeLookingGlassBridge.test.ts`, `lib/avatar/vrmMorphTargetRepair.test.ts`).
- **11 warnings eslint pré-existants** dans `ChatPanel.tsx` (lignes non touchées).
- **Persistance** : `localStorage` (`sessionConfig.ts`, `characterConfig.ts`, clé onboarding, `environmentConfig.ts`) + **IndexedDB** (DB `liteforms` : `indexedDbCredentialRepository.ts`, `indexedDbVrmRepository.ts`). Dossier `%APPDATA%\liteforms-web` (userData). Par origine. `/hologram` n'écrit rien.

### 1.4 Les 6 commits `Jarvis:` (base du miroir)

1. `ba4f8e7` — **fix packaged Next server location** : standalone copié dans `resources/next` (`afterPack` `cpSync .next/standalone`), `resolveStandaloneDir`, excludes tsconfig.
2. `8e395fe` — **add app in systray with logo** : tray/park hors-écran/`setSkipTaskbar`, `resources/` (icon.ico, icon-256.png, icon-32.png), `scripts/generate-icons.mjs`, `win.icon`.
3. `f7a51ea` — **add diagnostics log and hologram DOM/probe instrumentation** : `diagnosticLog.ts`, preload, `writeDiagnostic`/`wireWebContentsDiagnostics`, pageLogRef.
4. `f219bf8` — **add hologram window on the Looking Glass display** : `windowOpenPolicy`, `hologramWindow.ts`, code intermédiaire du protocol/bridge/page holo.
5. `bdde1f8` — **relay TTS and realtime voice into the hologram window for lip-sync** : ChatPanel final + protocol/bridge/page holo finaux.
6. `759174d` — **add master plan for the Liteforms appliance roadmap** : ce `PLAN_DIRECTEUR.md`.

**Règle de travail** : commits `Jarvis: <sujet anglais>`, créés localement dans le miroir, **aucun push sans accord**.

### 1.5 Dernier port effectué (non encore commité nulle part)

**`a5c88bb` « Change Alcove color in UI » porté dans le workspace** `C:\dev\liteforms-electron`, adapté aux divergences (holo/`hideVrButton`) :

- nouveaux : `lib/storage/environmentConfig.ts`, `environmentConfig.test.ts` ;
- modifiés : `environmentLoader.ts` (tint + snapshot matières/WeakMap), `environmentLoader.test.ts` (+4 tests), `AvatarScene.tsx` (prop `environmentTint`, refs, apply au chargement + cleanup + `useEffect`), `ChatPanel.tsx` (props/état/handlers + rangée « Alcove color » sous Load VRM, panneau Advanced), `app/page.tsx` (état + `loadEnvironmentConfig` + handler persisté + câblage props), `app/globals.css` (`.alcove-color-label`, `.advanced-hint`) ;
- **`/hologram`** : la fenêtre holo lit `loadEnvironmentConfig()` au montage + écoute l'événement **`storage`** → le tint se met à jour **en direct** depuis la fenêtre principale (même origine `localStorage`, aucun IPC nécessaire) ; Reset → matières d'origine.

### 1.6 Fix persistance des réglages en app packagée (10/09/2026)

**Symptôme** : une clef API (ou toute autre réglage) saisie dans l'app packagée
disparaissait après chaque redémarrage de l'app.

**Cause racine** : le serveur Next embarqué écoutait sur un **port aléatoire**
(`getAvailablePort()` → `listen(0)`) à chaque lancement (`electron/main.ts`),
et la fenêtre chargeait `http://127.0.0.1:<port>` derrière. Chromium stocke
`localStorage` + IndexedDB **par origine** (host + port), donc chaque lancement
reprenait depuis une origine neuve et vide. Les données étaient bien écrites sur
disque (`%APPDATA%\liteforms-web`), juste orphelinées sous l'origine des anciens
ports — jamais relues. Sont concernés : clefs API (`liteforms.credentials`),
config de session (`liteforms.sessionConfig`), personnage
(`liteforms.characterConfig`), VRM (`liteforms` IndexedDB), via les sections
correspondantes de §1.3.

**Fix** (validé matériellement sous Windows le 10/09/2026) :

- `electron/nextServer.ts` : port **fixe** `43178` (`LITEFORMS_SERVER_PORT`),
  détection `isHttpServerUp(url)`, `getAvailablePort()` supprimée ;
- `electron/main.ts` (`startPackagedNextServer`) : si quelque chose répond déjà
  sur le port fixe (serveur orphelin d'un run crashé, ou seconde instance), on
  le **réutilise** au lieu d'en lancer un second ;
- test : le comportement de `isHttpServerUp` (serveur vivant détecté, port
  mort refusé) dans `electron/electronBuild.test.ts`.

**Limites connues** :
- le chemin dev (`npm run dev:electron`, origin `http://localhost:3000`) n'a
  jamais eu le bug (port fixe d'office) et garde son propre profil séparé ;
- les données saisies avant le fix (sous d'anciens origines à ports aléatoires)
  ne sont **pas** récupérées — à resaisir une fois ;
- le port fixe doit rester libre pour l'app ; s'il est occupé par autre chose,
  l'app réutilisera ce répondant (voir `ponytail:` dans `main.ts`).
- si le run précédent a été tué durement, un serveur orphelin peut rester en
  mémoire : le chemin « réutilisation » gère ce cas transparentement.

---

## 2. Audit du portage web → Electron (31 commits `Jarvis:`)

### 2.1 Méthode

Fichiers des commits comparés entre l'arbre Electron actuel, la base commune `7fa7670` et le HEAD web. Résultat : **tous les modules partagés ont divergé** (l'app Electron a une base plus récente : LKG + holo + systray), seul `environmentLoader.ts` est identique au HEAD web (porté). En conséquence **chaque port demande une adaptation**, mais rien ne dépend d'API OS/bridge natif → **faisabilité quasi maximale partout**.

### 2.2 Tableau d'audit complet

| # | Commit | Contenu | Diff | Faisa | Notes |
|---|---|---|---|---|---|
| 1 | `4952eed` | Init + docs `.md` | 1 | N/A | documents seulement |
| 2 | `985278b` | Update provider + erreurs système | 2 | 10 | probablement déjà couvert par la base Electron (onboarding plus riche) |
| 3 | `b124d76` | Lipsync OpenAI TTS | 3 | 9 | ≈ chaîne lip-sync LKG déjà en place (`vrmRuntimeAnimator` divergé) |
| 4 | `aba7316` | Modale vitesse d'élocution OpenAI | 2 | 10 | `OnboardingModal.tsx` à adapter |
| 5 | `95b2784` | Meilleur idle loop + foot place | 3 | 9 | équivalent déjà présent : `VrmIdleAnimator` (`vrmAnimationLoader.ts`) + `vrmFootPlantLock.ts` |
| 6 | `ff26033` | Depth VRM dans l'alcove | 2 | 10 | à retuner pour le viewport `/hologram` |
| 7 | `050c195` | Recenter hips animation | 2 | 10 | `vrmAnimationLoader.ts` |
| 8 | `a5c88bb` | **Alcove color** | ✅ | **fait** (4 effectif) | porté + `/hologram` (§1.5) ; **fix 15/09** (`8461e38`) : le port écrivait le tint sur l'`AmbientLight` (rendu dilué, jalons jamais intenses) — root cause : `applyEnvironmentTint` absent du loader ; rétabli web-parité (`environmentLoader`/`AvatarScene`/`environmentConfig` strict hex+null ; matériau teinté, map supprimée, ambient fixe `#fff6e5`) |
| 9 | `bf978b2` | Emotion en face | ✅ | **partiel** (5 effectif) | mood **appliqué** : `moodConfig` (storage, copy web-parité), `applyVrmMoodPreset` (`vrmExpressionController.applyVrmExpression(1)`, web-parité), `AvatarScene` prop `expressionPreset` (live + post-load), `/hologram` suit `liteforms.moodConfig` via storage-event, chaîne device-config (hook `onMoodPreset` + `saveMoodConfig` + `applied.push("mood")`). **Audit portage** : `moodConfig` conservé tel quel (copie fidèle) ; `applyVrmMoodPreset` conservé (réutilise les fonctions déjà présentes de la copie Electron du controller) ; pattern AvatarScene réimplémenté sur la structure divergée (ref + effect, même pattern que `environmentTintRef`). **Volontairement non porté** : l'UI desktop (§3.1) — `MOOD_OPTIONS`/select `ChatPanel` et handlers `app/page.tsx` web ; le mood vient exclusivement de `POST /api/device-config` (Mobile). **Bug latent corrigé au passage** : `avatar.mood: null` (Mobile « Défaut ») était rejeté en 400 — null/unknown préréglage deviennent warning + mood ignoré, jamais de 400. **Pose : implémentée le 17/09** (`lib/avatar/avatarPose.ts` + `lib/storage/poseConfig.ts` + prop `AvatarScene` + hook `onPose`, `/hologram` via storage-event) — validation terrain à faire ; sémantique dans `protocol/DEVICE_API.md` §Bloc `avatar.pose` |
| 10 | `922809e` | Fix bugs core | 3 | 8 | re-corriger manuellement un `ChatPanel` fortement divergé |
| 11 | `5086b76` | **Bundle OpenWakeWord** | 7 | 8 | gros kit (moteur ort + modèles `.onnx` + worklet + featureFlags) ; `onnxruntime-web@1.21` **déjà en deps** ; threading wasm → voir §6.4 |
| 12 | `a72535d` | UI wake word + fixes activation | 3 | 9 | dépend du bundle #11 |
| 13 | `bc9d76e` | Sélection modèle + persistance | 3 | 9 | `wakeWordConfig`/store |
| 14 | `351b034` | Câblage UI wake word | 3 | 9 | `ChatPanel` divergé |
| 15 | `f0e4ee9` | POC panel étendu | 2 | 9 | composant+tests |
| 16 | `2033482` | Cue wake word (blink alcove + greeting) | 4 | 9 | à adapter à l'animator Electron (`idleChoreographer` ≠ absence Electron) |
| 17 | `bf81276` | Cue configurable | 3 | 9 | storage `wakeWordConfig` |
| 18 | `3948403` | Doc études | 1 | N/A | documents |
| 19 | `949dee2` | Sessions OpenClaw réutilisées (conversation ids) | 4 | 9 | `adapters.ts`/`types.ts` divergés |
| 20 | `a3c1f90` | Conversation id stable → LLM | 3 | 9 | `ChatPanel` |
| 21 | `a6dd16a` | Max 2 TTS concurrents | 3 | 9 | throttling dans le `ChatPanel` divergé |
| 22 | `e1e0c13` | Strip markdown (display + parlé) | 2 | 10 | logique pure (`lib/llm/output.ts`, `lib/speech/tts.ts`) |
| 23 | `21ac88a` | Doc suite | 1 | N/A | documents |
| 24 | `28cc967` | **Function calling + OpenClaw + audio utils** | 6 | 9 | routes Next **tournent dans le standalone** ✓ ; `audioUtils` ≈ `audioPlayback` existant ; tools à réinjecter dans `googleLive`/`openAiRealtime` + `ChatPanel`/holo ; `openclawGatewayToken` |
| 25 | `de2aed2` | TimerManager | 2 | 10 | module 100 % client |
| 26 | `f0884a7` | Tools timer realtime | 3 | 9 | fournisseurs realtime |
| 27 | `a9df03e` | Timers dans ChatPanel (chime + notif) | 4 | 9 | UI + audio chime |
| 28 | `e1037ce` | get_current_date | 3 | 9 | après l'infra #24 |
| 29 | `9fc237f` | calculate + parser sûr | 3 | 9 | parser pur + route |

### 2.3 Verdict du portage

- **100 % faisable** (faisabilité ≥ 8/10 partout).
- Les **2 vrais chantiers** : `5086b76` (wake word complet) et `28cc967` (function calling realtime).
- Le reste : adaptations mineures de fichiers divergés.

---

## 3. Décisions produit (établies avec l'utilisateur)

### 3.1 Configuration déléguée au smartphone

1. **Source de vérité = le téléphone.** L'UI desktop n'est pas éditée (POC).
2. **Live sans reboot** : chaque changement est appliqué immédiatement par l'app (voir §4).
3. **VRM** : le fichier `.vrm` reste **sur la machine** (déjà en IndexedDB) ; le téléphone envoie seulement le **choix du modèle** (nom/référence), pas un upload.
4. ~~**Sécurité minimale au POC** : un token d'appairage suffit~~ **[MISE À JOUR 10/09 — contrat mobile v1 verrouillé]** : la v1 délibérée avec le Mobile est **sans token** (LAN local de confiance) ; appairage (device/token) repoussé à la phase 4. Voir §4.4.

### 3.2 Parcours utilisateur cible (appliance)

```
1. Brancher le Mini-PC → ON        (Electron démarre en auto-start)
2. Electron crée le hotspot `Liteforms-Setup-XXXX`  (mode provisioning, 1er boot ;
   **contrat v1 : SSID `Liteforms-Setup-XXXX`, service sur `192.168.4.1:8080`** —
   et l'appliance n'affiche **aucun** code/QR/écran de configuration, §4.4)
3. Le mobile rejoint le hotspot via les réglages WiFi système (iOS :
   instruction + ouverture des réglages, pas de sélection programmatique)
4. L'app mobile demande le Wi-Fi maison (SSID + mot de passe) → POST à Electron
5. Electron configure le WiFi cible (Linux : NetworkManager/nmcli ;
   Windows : profil WLAN `netsh wlan add profile` ou API WinRT —
   **voir §6.2, Windows doit aussi être fonctionnel**) → le poste rejoint le Wi-Fi
   maison, abandonne son hotspot
6. Le téléphone rejoint le même Wi-Fi → communication LAN normale
   (découverte par **IP manuelle d'abord, mDNS ensuite**)
+ Sécurité d'association pendant le provisioning :
   mini PC génère DEVICE_ID + PAIRING_SECRET ; Electron garde la liste
   (Device, Paired-Phone, Token) ; toute écriture config exige le token.
   **[contrat v1 10/09 : pas de token au provisioning ni sur device-config ;
   cette association device/token est REPORTÉE phase 4]**
```

> ⚠️ Ancien texte de phasage (obsolète depuis le contrat mobile 10/09, conservé pour trace) : au POC, le provisioning manuel (IP + code à 6 chiffres affiché à l'écran) remplace les étapes 2-5. Le hotspot n'arrive qu'en phase 3.
> **Le contrat contracte le hotspot dès le flux initial** (étape 2 des priorités Electron) — et le code/QR à l'écran est désormais **interdit** (l'appliance n'affiche rien, §4.4).

---

## 4. Architecture « config téléphone → Electron » (POC)

### 4.1 Réalité d'architecture à connaître

- Toute la config vit **côté renderer** (`localStorage` + IndexedDB). Les **routes Next tournent dans le processus serveur** (Node) qui n'a pas accès au `localStorage` du renderer.
- Il faut donc un chemin **serveur → main → renderer** :

```
Téléphone ─POST /api/device-config (token)─▶ serveur Next local
       │ écrit device-config.json dans userData
       ▼
Main Electron ─fs.watch / polling─▶ webContents.send("device-config-change", json)
       ▼ (via le preload déjà en place)
Renderer ─fonction applyDeviceConfig()─▶ setters existants (rendu live)
```

- Alternative simple au POC : le renderer **polle** `GET /api/device-config` toutes les 2 s (moins de code que `fs.watch` main→IPC). Passing à un push (SSE/WebSocket ou IPC) ensuite.

### 4.2 L'application (apply live) réutilise l'existant

| Config poussée | Application côté Electron | Réalité technique |
|---|---|---|
| `alcoveColor` | `setAlcoveColor` | changement visuel immédiat (état déjà en place) |
| `character` | `setCharacter` + `saveCharacterConfig` | identité/mot d'accueil à l'écran |
| LLM/TTS/ASR (modèles…) | maj des `initialConfig` + **bump `chatPanelKey`** | remontage du ChatPanel = **le flow d'onboarding existant** (« React 18 batches these updates ») |
| `vrm` (choix modèle) | lookup **IndexedDB** par `fileName` → `setModelUrl(blobUrl)` | effet `[modelUrl]` déjà géré |
| (futur) wake word | `wakeWordSettingsStore` partagée | idem |

- **Micro-extension** nécessaire : méthode `list()`/`loadByName()` dans `indexedDbVrmRepository` (aujourd'hui `load()` seul).
- ~~**Credentials** : le téléphone les envoie pour configurer~~ **[Corrigé par le contrat v1, §4.4]** : le Mobile ne pousse **pas** de credentials provider (payload sans champ `credential`) ; les secrets restent saisis *sur* le desktop. On ne les renvoie jamais sur le réseau (§6.3), `GET /api/provider-status` expose uniquement des statuts masqués.

### 4.3 Récepteur côté app

- L'écoute réseau : le serveur Next écoute sur `127.0.0.1` aujourd'hui → à binder sur la carte LAN (`0.0.0.0`/IP locale). Conséquence Windows : **pop-up pare-feu à accepter** au 1er run (réseau privé). Sur Linux : mêmes questions.
- **Port du service de provisioning (contrat v1, résolu)** : défaut **`8080`**, **paramètre de configuration** de l'Electron (pas du Mobile) — lier 80/443 exige des privilèges admin, inacceptable pour une app Desktop utilisateur ; le port effectif est annoncé dans la réponse de `GET /api/provisioning/health` (champ `port`) puis via mDNS (plus tard).

### 4.4 Contrat LAN Mobile ↔ Electron — **verrouillé v1, app mobile prête** (10/09/2026)

Source de vérité : `C:\dev\Liteforms-Mobile-Application\docs\contract\` (README + JSON d'exemples, repris verbatim ci-dessous). L'application mobile est **déjà implémentée et terminée** ; tout le travail restant est **côté Electron**.

**Contrainde produit** : l'appliance n'affiche **que** l'avatar — aucun code, QR, menu ou écran de configuration (ce qui invalide le vieux POC « IP + code à 6 chiffres affiché à l'écran »).

**Flux complet** :

```text
Electron démarre
  -> crée le hotspot Liteforms-Setup-XXXX
  -> écoute 192.168.4.1:8080

Mobile
  -> rejoint le hotspot via les réglages WiFi système
  -> GET  /api/provisioning/health
  -> POST /api/provisioning/wifi

Electron
  -> stocke le WiFi cible dans son stockage local sécurisé
  -> arrête le hotspot temporaire
  -> rejoint le WiFi cible

Mobile
  -> retrouve Electron sur le LAN (IP manuelle d'abord, mDNS ensuite)
  -> GET  /api/health
  -> POST /api/device-config
```

**Routes** (auth v1 = **aucune**, LAN local traité comme réseau de confiance) :

| Route | Méthode | Usage | Réponse |
|---|---|---|---|
| `/api/provisioning/health` | GET | vérifier le hotspot Liteforms | `{ok, mode:"provisioning", deviceId:"desktop-8f31", name:"Liteforms Desktop", protocolVersion:"1.0", port:8080}` — l'Electron **annonce son port effectif** ici |
| `/api/provisioning/wifi` | POST | envoyer SSID/mot de passe du WiFi cible | 202 `{ok:true, restartRequired:true, message:"WiFi configuration accepted"}` ; 400 `{ok:false, code:"INVALID_WIFI_CONFIG", message}` |
| `/api/health` | GET | vérifier Electron sur le réseau normal | `{ok, name, protocolVersion, configVersions:["1.0"], networkMode:"ethernet"\|"wifi"\|"provisioning"}` |
| `/api/device-config` | POST | envoyer la configuration ordinaire | 200 `{ok, configVersion, appliedAt, warnings:[]}` ; erreurs `{ok:false, code, message}` codes min `INVALID_FIELD`, `UNSUPPORTED_CONFIG_VERSION`, `MODEL_REF_UNKNOWN` |
| `/api/provider-status` | GET | lire des statuts **masqués** | `{ok, providers:{llm,tts,stt: {provider, configured, maskedKey}}}` — `maskedKey` jamais une clé réelle |

**Règles transverses** : requêtes idempotentes ; champs inconnus ignorés ; le mot de passe WiFi n'apparaît jamais dans réponses/logs/erreurs ; la route de provisioning n'est active **que** en mode hotspot puis fermée ; le mobile n'envoie pas de config Avatar tant que `/api/health` renvoie `networkMode:"provisioning"` ; sur iOS le mobile ne promet pas de connexion WiFi automatique.

**Règles credentials (contrat v1, section « Regles credentials » du README distant)** :

- **Le Mobile est l'ÉMETTEUR** de toutes les données vers le Desktop — config ordinaire (`device-config`) et credentials WiFi (`provisioning/wifi`, envoi **unique** sur le hotspot isolé). Le Desktop ne décide jamais de la config : il la **reçoit et l'applique**.
- `device-config` ne transporte **aucun secret** : ni clé provider, ni token de pairing, ni mot de passe WiFi.
- Le mécanisme de stockage des credentials WiFi (trousse OS, fichier chiffré…) est un **détail d'implémentation** de l'Electron ; l'exigence de contrat est : jamais dans les logs, les réponses des autres routes, ou un message d'erreur.
- Les **clés API providers vivent côté Electron**. Si un jour l'utilisateur les saisit depuis le Mobile (décision **D1**, phase 8), elles passent par une route **dédiée one-shot** `POST /api/credentials` — jamais via `device-config`.
- `/api/provider-status` ne contient que `configured` et `maskedKey` (`sk-****`) — jamais une clé réelle.

**Corps de `POST /api/device-config`** (exact, v1) :

```json
{
  "configVersion": "1.0",
  "character": { "name", "pronouns": "HE"|"SHE"|"THEY", "personality", "greeting" },
  "avatar": {
    "mood": "happy",
    "modelRef": { "id": "lobsterEdit", "fileName": "lobsterEdit.vrm", "hash": null },
    "pose":    { "avatarYaw": 0, "alcoveYaw": 0, "zoom": 1, "depth": 0 }
  },
  "environment": { "alcoveColor": "#4a90d9" },
  "providers": {
    "llm": { "provider", "model", "endpoint", "voiceId": null },
    "tts": { "provider", "model", "endpoint", "voiceId" },
    "stt": { "provider", "model", "endpoint", "voiceId": null }
  }
}
```

**Mapping vers l'existant (apply live, §4.2)** :

| Champ contrat | Côté Electron | Note |
|---|---|---|
| `character.*` | `setCharacter` + `saveCharacterConfig` | identique |
| `environment.alcoveColor` | `setAlcoveColor` | identique |
| `avatar.modelRef` | lookup IndexedDB par `fileName` (`list()`/`loadByName()` manquants, §8) | `hash` peut être `null` → le desktop ne doit pas l'exiger pour valider |
| `avatar.mood` | `moodConfig` + `applyVrmMoodPreset` + prop `AvatarScene` (port #9, commit `e402db0`) | **appliqué à chaud**, fenêtre principale + `/hologram` |
| `avatar.pose` (avatarYaw/alcoveYaw/zoom/depth) | `lib/avatar/avatarPose.ts` (logique pure) + `lib/storage/poseConfig.ts` (`liteforms.poseConfig`) + `AvatarScene` prop `pose`, hook `onPose` | **implémenté 17/09, validation terrain à faire** ; sémantique normative : `protocol/DEVICE_API.md` §Bloc `avatar.pose` ; référence = preview Mobile (`previewRuntime.ts`) |
| `providers.{llm,tts,stt}` | `SessionConfig` (`saveSessionConfig`) + remontage ChatPanel (`chatPanelKey`) | **`stt` ≈ `asr` côté Electron** (renommage au mapping) ; **pas de champ `credential`** dans le payload |

**Ce qui change vs le plan initial** (deltas à retenir) :

1. **Pas de token en v1** : ni sur `device-config` ni sur le provisioning. Le « token minimal » du POC (§5 Phase 2, §6.3) est reporté phase 4. Contrat assumé : LAN de confiance.
2. **Pas de credentials dans le payload** : le téléphone ne pousse *que* la config ordinatoire (`providers` sans clé API) — cohérent avec « secrets au desktop, jamais sur le téléphone ». L'ancienne ligne §4.2 « Credentials : le téléphone les envoie pour configurer » est **corrigée par ce contrat**.
3. **Provisioning hotspot dès le flux initial** (pas phase 3) : SSID `Liteforms-Setup-XXXX` (ex `JARVIS-XXXX`), service sur `192.168.4.1:8080`.
4. **Pas de QR ni de code affiché à l'écran** — l'appliance n'affiche rien.
5. `GET /api/provider-status` remplace `GET /api/device-config` (lecture) ; `configVersions:["1.0"]` présent dans `/api/health`.
6. Nouveaux blocs de config auparavant non identifiés dans le plan : `avatar.mood`, `avatar.pose`, `voiceId` par provider, `stt` (vs `asr`).
7. Router captive-portal : le contrat évite la page captive (réglages WiFi système depuis le mobile) — les sondes `/generate_204` sont donc **hors du chemin critique** (§6.6 reste valable comme robustesse).

**Priorités Electron** (ordre du contrat, à reporter dans §8) :

1. Créer le hotspot temporaire `Liteforms-Setup-XXXX` et écouter `192.168.4.1:8080` ;
2. `GET /api/provisioning/health` ;
3. `POST /api/provisioning/wifi` + transition vers le WiFi cible ;
4. Fermer le mode provisioning après configuration acceptée ;
5. `GET /api/health` sur le réseau normal ;
6. `POST /api/device-config` + `GET /api/provider-status`.

---

## 5. Feuille de route phasée (critères de sortie, difficulté, risques)

### Phase 0 — Portage web → Electron
**Objectif** : récupérer la valeur des 31 commits `Jarvis:` du web.
**Ordre suggéré** (du plus sûr au plus structurant) :
1. Logique pure / modules autonomes : 22 (strip markdown), 25 (TimerManager), 26, 28, 29 (function calling + parser), 6, 7 (retunes) ;
2. ChatPanel (20, 21, 3, 10, 27) ;
3. Providers/adapters (2, 19, 24 core) ;
4. Émotion (9) ;
5. **Wake word** (11→17) en dernier (gros bloc, plus d'incertitude).
**Vérif** : après chaque groupe — `npm test`, `npm run lint`, `npx tsc --noEmit`, build.
**Difficulté cumulée** : ~2/10 (logique pure) à 7/10 (wake word). **Faisabilité : 9/10.**

### Phase 1 — L'holo sur Linux (à tester en premier — risque **rétrogradé**)
**Objectif** : preuve que le Looking Glass rend correctement depuis un Mini-PC **Linux**.
**⚠ État 30/08/2026** : le chemin **officiel existe** (voir §6.1/§6.10). Le Bridge Looking Glass a une **version Linux 2.6.3** (installateur Ubuntu `.sh`), exige **X11** (Wayland non supporté). Plus le SDK natif était Win/Mac ; on dispose désormais de **bridge.js** (websocket, OS-indépendant, déjà embarqué dans l'app) et du **Bridge-Python-SDK officiel** (wheels manylinux x86-64/arm64 avec driver embarqué). Reste **3 validations** (week-end) :
1. Ubuntu **24.04 LTS X11** + build **AppImage/.deb sur Linux** (x86_64) ;
2. **Bridge 2.6.3** opérationnel + le **probe natif** échoue gracieusement → le path **websocket JS** prend le relais (`bridge.js`) ; vérifier compat version du `@lookingglass/bridge@0.0.8-alpha.4` embarqué ;
3. **Énumération du LKG en affichage DRM** via le port USB-C (DP alt mode) — la pièce hardware à vérifier.
**Fallback en secours** : HLD (compositor logiciel, déjà en place) → sinon Bridge-Python-SDK.
**Critère de sortie** : qualité d'image/sync acceptable sur l'appareil.
**Difficulté : 3–4/10 (configuration, plus un pari). Faisabilité : 9,5/10.**

### Phase 2 — POC config téléphone → live (⚠️ périmètre redéfini par le contrat mobile v1, §4.4)

> **STATUT : TERMINÉ ET VALIDÉ TERRAIN (12/09/2026)** — voir `POC.md` §13
> pour le bilan complet, les enseignements et la répartition
> gardé/rejetté en architecture finale. Résumé :
>
> * **Fait et validé** : `GET /api/health` (bind LAN opt-in
>   `LITEFORMS_SERVER_HOST`, port 43178), `POST /api/device-config`
>   (validation sans confiance, idempotence, secrets rejetés, warnings
>   mood/pose), apply renderer à chaud (character, alcove via
>   `environmentConfig` + propagation `/hologram`, providers via mapping
>   `stt->asr`/`endpoint->baseUrl` + bump `chatPanelKey`, VRM via
>   bibliothèque locale `<userData>/vrm-library/`), lecture Mobile de la
>   bibliothèque VRM réelle, swap VRM à chaud **sur le Looking Glass**
>   (avec fix teardown session XR — invariant à conserver, `POC.md` §13.2).
> * **Non fait (reporté, hors POC)** : provisioning hotspot (priorités 1–4
>   ci-dessous), mood/pose (warnings), mDNS.
> * **Choix de périmètre notables** : port renderer `43178` conservé
>   (invariant d'origine Chromium pour la persistance — `POC.md` §13.3.2) ;
>   `8080` reste le port de provisioning du contrat final, décision
>   d'intégration ultérieure.
> * **Suite naturelle (vers Phase 3)** : persistance durable
>   device-config dans `userData` (le park en mémoire était POC),
>   provisioning hotspot, détection automatique du token OpenClaw local
>   (`POC.md` §7.1).

**Objectif** : config maîtrisée depuis le téléphone, appliquée en direct.
**Livrables** (contrat v1 verrouillé — l'app mobile existe déjà, tout le reste est côté Electron) :
- provisioning **hotspot** (`Liteforms-Setup-XXXX`, `192.168.4.1:8080`, `POST /api/provisioning/wifi` + transition WiFi — cf. §4.4, priorités 1–4) ;
- route `POST /api/device-config` **sans token** (v1 LAN de confiance) ;
- `GET /api/health` + `GET /api/provider-status` (statuts masqués) ;
- watcher ou polling → événement IPC → `applyDeviceConfig()` ;
- app mobile : **déjà prête** (sélection WiFi via réglages système, IP manuelle puis mDNS).
**Critère de sortie** : provisioning WiFi via hotspot puis pousser `character`, `alcoveColor`, provider LLM/TTS/stt, `mood`/`pose`, un `modelRef` depuis le téléphone → appliqués **à chaud**.
**Difficulté côté Electron : 3–4/10. Faisabilité : 9–10/10.**
~~Preview 3D sur le téléphone~~ : hors périmètre du contrat v1 (aucune exigence de preview dans `docs/contract` ; le mobile livré s'appuie sur `modelRef` + statuts).

### Phase 3 — Le confort appliance
**Objectif** : l'expérience « on le branche, ça marche ».
**Livrables** :
- **autostart** Linux (`.desktop` → `~/.config/autostart`), mode provisioning sur 1er boot (machine à états `provisioned ?`) ;
- **provisioning hotspot** — **double cible (décision 13/09/2026 : Linux principal, Windows fonctionnel requis)** :
  - **Linux** : `nmcli device wifi hotspot` / `nmcli con up` → **helper privilégié (polkit ou service systemd + dialogue socket)** ;
  - **Windows** : Mobile Hotspot WinRT (`NetworkOperatorTetheringManager`, §6.2) + fallback **LAN direct sans hotspot** (PC déjà sur le WiFi maison → `device-config` direct) ;
  - interface commune derrière un même service de provisioning (détecter la plateforme, mêmes routes contrat v1).
- **mDNS** (`jarvis.local`, avahi/bonjour-service) ;
- **pairing complet** : génération `DEVICE_ID` + `PAIRING_SECRET`, stockage devices/phones/token dans `userData`, middleware de token ;
- **auto-update** (AppImage/.deb, sign).
**Difficulté : 5–6/10 (concentrée sur le helper privilégié + machine à états). Faisabilité : 9/10.**

### Phase 4 — Sécurité durcie
**Objectif** : fermer les failles du POC.
**Livrables** : TLS local (certificat auto-signé éphémère) ; **rotation de token** ; gestion propriétaire/devices (le téléphone qui provisionne est l'owner ; les autres doivent se re-pairer) ; **jamais de retour des credentials** sur le réseau ; rate-limiting ; nettoyage du secret après appairage.
**Difficulté : 3/10. Faisabilité : 9/10.**

---

## 5bis. Provisioning WiFi contrat v1 — implémenté et validé terrain Windows (13/09/2026)

> Détail des incidents/leçons : §10 (post-mortem). Code : `electron/wifi/` (commits
> `c5722ea`, `5f8511a`, `6bd200b`), protocole inchangé (contrat v1 §4.4).

### 5bis.1 Architecture livrée
- **Machine à états** (`provisioningService.ts`) : `idle → starting → provisioning → switching` ;
  persistance safeStorage **avant** arrêt hotspot (invariant) ; idempotence ; 202 contractuel
  envoyé **dès la persistance** (transition stop+join en arrière-plan, exposée via
  `service.transition`) ; **le relaunch attend la fin complète de la transition**
  (le tuer avant = join mort, incident terrain n°4).
- **Serveur provisioning dédié** (main process, PAS Next) : `GET /api/provisioning/health`,
  `POST /api/provisioning/wifi`, **`GET /api/health`** (`networkMode:"provisioning"`),
  404 plat ailleurs ; meurt avec le mode provisioning (invariant contrat).
- **Abstraction plateforme** (`provisioningPlatform.ts`) : Windows (Mobile Hotspot WinRT
  via PowerShell, bande **2,4 GHz forcée**, join par profil WLAN + **retry 0/3/6 s**) /
  Linux (`nmcli`, bande `bg` forcée, pin `192.168.4.1/24` puis **IP réelle détectée**,
  vérification actif+IPv4 avant annonce, retry join).
- **Pare-feu** : règles NSIS à l'install (`resources/installer.nsh`, 8080+43178) ;
  win-unpacked : tentative au boot puis instruction netsh exacte dans le diagnostic ;
  Linux : ufw via le même chemin privilégié, sinon instruction loggée.
- **Privilèges Linux** : règle polkit `resources/linux/10-liteforms-network.rules` +
  `install-polkit.sh` — portés par l'**image dorée** (§6.11), pas par l'AppImage.
- **Stockage** : `<userData>/wifi-credentials.json`, mot de passe chiffré safeStorage
  (DPAPI), jamais en clair/loggé/retourné (test dédié).

### 5bis.2 Cycle validé terrain Windows (13/09, log diagnostic)
`hotspot up (2,4 GHz) → Mobile: health OK → POST wifi → persisted → 202 → hotspot
stopped → join result=ok (1er essai) → transition complete → relaunch →
credentials already provisioned, normal boot → /api/health networkMode:"wifi"`.

### 5bis.3 Limites connues (acceptées pour l'instant)
- Windows : le hotspot WinRT exige une connexion internet source (Ethernet au test) —
  contrainte OS, scénario « zéro réseau » = Linux natif (`nmcli` hotspot autonome) ;
  Windows = environnement de dev (décision produit 13/09).
- Mobile : « fetch failed » affiché alors que le 202 est parti (réponse coupée par la
  mort du hotspot) ; `provisionWifi` lit le store au lieu des champs saisis.
  → Les deux sont des items de la refonte §5ter.
- L'utilisateur doit **ressaisir l'IP LAN** après provisioning → remplacé par la
  découverte §5ter (refus produit explicite).

### 5bis.5 Limites Windows « machine standard » (audit 13/09, post-cycle vert)

Windows reste environnement de dev ; voici ce qui casse (ou pas) sur un
Windows 11 stock, et les mitigations en place :

| Point | Gravité | État |
|---|---|---|
| Réseau classé « Public » par défaut | 🔴 contourné | règles pare-feu créées **sans** `profile=` → s'appliquent à tous les profils (comportement netsh documenté) ; NSIS les pose à l'install |
| **Localisation Windows 11 désactivée** (`netsh wlan` erreur 5) | 🔴 non contournable côté app | boot v2 → retour provisioning → le Mobile voit `phase:"failed"` avec le message dédié « activez la localisation » (13/09) ; l'app ne peut pas activer la localisation elle-même (aucune API autorisée) |
| Pop-up pare-feu 1er run (win-unpacked) | 🟡 contourné | avec l'installeur NSIS : pas de pop-up (règles pré-créées) ; win-unpacked : instruction netsh loggée |
| Antivirus tiers (pare-feu applicatif) | 🟡 documenté | ignore les règles Windows ; détection possible via diagnostic (joignable en local, pas du LAN) ; FAQ |
| Mini-PC sans adaptateur WiFi (Ethernet only) | 🟡 structurel | pas de hotspot WinRT possible → fallback LAN-direct only ; sur Linux `nmcli` gère le hotspot autonome |
| `netsh wlan add profile user=all` exige admin | 🟢 corrigé 13/09 | `user=current` (l'app tourne en utilisateur de session) |

**Conclusion** : le chemin Windows est viable en dev/test avec installeur ;
la production appliance reste Linux (image dorée §6.11 : polkit, ufw, pas de
localisation, pas d'AV tiers — tout est contrôlé).

### 5bis.4 Checklist validation terrain Linux (week-end Phase 1, mini-PC)
1. `sudo sh resources/linux/install-polkit.sh` (image dorée) ;
2. boot sans credentials → hotspot up, log `hotspot up gateway=...` ;
3. `nmcli -t -f GENERAL.STATE,IP4.ADDRESS1 connection show Hotspot` → activated +
   `192.168.4.1/24` ; SSID visible en 2,4 GHz ; `http://192.168.4.1:8080` OK ;
4. cas dégradé A : pin refusé → l'IP réelle (ex. `10.42.0.1`) est annoncée dans le
   diagnostic et saisie côté mobile ;
5. cas dégradé B : règle polkit absente → hint polkit dans le diagnostic, pas de crash ;
6. ufw actif → ports ouverts ou instruction `sudo ufw allow` loggée ; POST wifi OK ;
7. join : 2,4 GHz, retry visible (0/5/10/15 s) si nécessaire, relaunch APRÈS la transition ;
8. mode normal : 43178 joignable depuis le LAN ;
9. Windows uninstall : règles netsh absentes après désinstallation.

### 5bis.6 Cycle « profil WLAN pré-existant » validé (13/09, 18:56)

Le cas réel de production (PC **déjà** connecté au WiFi maison, profil WLAN
« tous les utilisateurs » existant) a été validé de bout en bout après deux
fixes définitifs :
1. **`netsh wlan connect` ne fait que demander** — le script attend maintenant
   l'association réelle (sonde d'état 12 s par tentative, la ligne SSID
   n'apparaît que connecté) ; retry étendu 0/5/10/15 s (commit `f8ecf24`) ;
2. **Profil pré-existant dans une autre plage** : `add user=current` échoue
   (« profil déjà existant ») → le connect s'exécute quand même ; si la
   connexion échoue, le profil périmé est supprimé et la retry le recrée
   (commit `34c8d22`).
Log de validation : `join result=ok` au 1er essai → boot v2 → normal
`networkMode:"wifi"` + `deviceId:"desktop-536f"`.

**Rappel périmètre réseau (validé factuellement)** : Linux = hotspot autonome
sans aucune connexion préexistante (`nmcli`), le scénario « appliance nue » est
couvert ; Windows = le hotspot WinRT exige une connexion source (Ethernet ou
WiFi), seul cas mort « zéro réseau » — accepté, Windows = dev (§5bis.5).

### 5ter.6 Améliorations UX provisioning (demandées 13/09 — **faites le 15/09**)

> Statut 15/09/2026 : les deux items sont **implémentés et testés** (vitest
> verts des deux côtés). prototypes terrain à refaire au prochain cycle
> Windows (le reset relaunch → provisioning est couvert par tests, pas
> encore par un cycle réel).

1. **Champ mot de passe WiFi visible** (mobile, écran 2) : ~~toggle~~ **œil
   classique dans le champ** (show/hide, `secureTextEntry` togglé, état
   local jamais persisté) — commit Mobile `36eef4e`. Le `secureTextEntry`
   rendait les fautes de saisie indétectables — cause probable de l'échec
   « mot de passe erroné » de 14:26/14:28 ;
2. **Re-appairage depuis le mobile** : bouton « Refaire l'appairage » (réglages
   avancés) déclenche la nouvelle route **`POST /api/provisioning/reset`**
   (protocole 15/09, `protocol/DEVICE_API.md`) : purge de `wifi-credentials.json`
   (route Next mode normal + env `LITEFORMS_WIFI_CREDENTIALS_PATH`,
   commit Electron `468bc67`) → watcher main React (file répérée = appelé une fois) →
   relaunch → **retour mode provisioning au boot v2**. Le mobile rebascule sur le flow
   d'appairage (reset local best-effort, échec réseau post-envoi = transition
   normale). Mobile commits `36eef4e`/`5ecaa68` (91 tests verts) ; Electron
   807 tests verts + tsc.

---

## 5ter. Onboarding mobile « zéro IP » + reconnexion automatique (chantier en cours)

**Décision produit (13/09)** : l'utilisateur lambda ne saisit **jamais** d'IP/port.
La saisie manuelle déménage dans **Paramètres → Connexion avancée** (IP + port + test —
usage dev/debug uniquement).

### 5ter.1 Flux cible
```
Lancement (1er fois OU connexion perdue — même flow, zéro duplication)
  → recherche automatique (scan si sur un WiFi)
  → échec → ÉCRAN 1 « Rejoignez le réseau Liteforms-Setup-XXXX » (+ bouton réglages WiFi)
  → ÉCRAN 2 « Votre WiFi » (SSID + mot de passe) → Envoyer
  → ÉCRAN 3 « Connexion en cours »
       · 202 → « Rejoignez maintenant votre WiFi maison » (l'appliance y va)
       · mobile bascule sur le WiFi maison (réglages système, comme aujourd'hui)
       · scan automatique → trouvé (deviceId matché) → « Connecté ✓ »
  → écrans de configuration existants (VRM, personnalité, providers…)
```

### 5ter.2 Découverte : scan de sous-réseau (primaire), mDNS (ultérieur)
- **Scan** : une fois le mobile sur le WiFi maison, balayage du /24 local
  (`GET /api/health` sur x.x.x.1→254, timeouts courts, parallèle), match sur le
  **`deviceId`** appris pendant le provisioning → zéro faux positif. Pur JS/Expo Go,
  ~5 s. Sert aussi à la **reconnexion auto** (changement de FAI/box) : au lancement,
  si le Desktop connu ne répond plus → scan → trouvé = reconnexion silencieuse,
  coordonnées mises à jour ; introuvable = ÉCRAN 1.
- **mDNS `jarvis.local`** : en optimisation quand on passera aux builds EAS (Phase 10) —
  le scan reste le fallback. Décision : **scan d'abord** (validée 13/09).

### 5ter.3 Auto-guérison côté appliance
**Boot v2** : credentials présents → test join au boot → **échec → retour en mode
provisioning (hotspot)** : l'appliance redevient trouvable, le mobile refait le flow.
C'est le pattern recovery des appliances sans écran (avec le bouton physique §6.7 en
filet ultime).

### 5ter.4 Patterns industriels de référence (règles de l'art)
Chromecast/Echo : canal de provisioning temporaire (hotspot) ✓ fait ; Sonos : découverte
par le réseau sans saisie d'IP ✓ §5ter.2 ; état visible : **le Looking Glass est notre
LED** — l'avatar/l'alcove peut refléter l'état provisioning (à explorer en §5ter) ;
recovery : bouton physique §6.7.

### 5ter.5 Modifications par repo (ordre d'exécution)
1. `protocol/DEVICE_API.md` : `GET /api/provisioning/status`
   (`{ok, phase:"joining"|"joined"|"failed", deviceId}` — le mobile sait si la transition
   a réussi même s'il rate le 202) ; **`deviceId` stable et persistant** (clé de
   matching du scan, aujourd'hui `"desktop"` en dur).
2. Electron : deviceId persistant (userData), boot v2 (échec join → provisioning),
   route status + tests.
3. Mobile : moteur de découverte (scan /24 + matching deviceId, client réseau pur testé),
   machine à états d'onboarding, 3 écrans du flow, `desktop.tsx` → « Connexion avancée »,
   fixes au passage (provisionWifi lit les champs saisis ; messages distinguant
   transition normale / vraie erreur).
4. Validation terrain Windows : cycle complet + re-pairing (changement de WiFi simulé).
5. Checklist Linux mise à jour.

---

## 6. Points de difficulté & risques (détaillés)

### 6.1 (Rétrogradé) Driver/affichage Looking Glass sous Linux — voir Phase 1
- **Élément clos à 30/08/2026** : le support Linux est **officiel** (voir §6.10). Looking Glass Bridge **2.6.3** sort en installateur Ubuntu ; le SDK natif (samples C++/C#) exige **X11, Wayland non supporté** ; la note vaut aussi pour les chemins JS et Python.
- Chemins disponibles sur Linux, du préféré au repli :
  1. **bridge.js** (websocket localhost) — l'app Electrons embarque déjà `@lookingglass/bridge` → **0 ligne à écrire**, à valider sur Linux (§6.10) ;
  2. **Bridge-Python-SDK** (`pip install bridge-python-sdk`) — wheels manylinux x86-64/arm64, **driver Bridge embarqué** (exemples `RotatingCube`, `SolarSystem`, `DisplayQuilt`, `DisplayRGBD`) ;
  3. **HLD** (compositor logiciel, déjà dans le code) — fallback pur.
- **Validé terrain 17/09/2026** : Ubuntu 24.04 X11 éligible, LKG Go énuméré en affichage DRM (USB-C/DP alt mode) ; **bascule websocket abandonnée** — le probe natif in-process fournit la calibration (`PLAN_LINUX_BRIDGE.md` §7). ⚠️ Réserve : le daemon LGB était installé sur l'appliance pendant le test → statut réel **non vérifié**, voir §8.

### 6.2 Privilèges Wi-Fi / NetworkManager
- `nmcli` (hotspot, rejoindre un réseau) = **root**.
- Archive propre : règle **polkit** mini PC ou **service systemd** launcher que l'app pilote. Si bricolé → cassure en prod.
- **Windows — solution fonctionnelle requise (décision 13/09/2026)** : la cible de production reste Linux, mais l'étape provisioning doit **aussi fonctionner sous Windows** (machine de dev + déploiements Windows éventuels). Deux chemins :
  1. **Hotspot Windows** : `netsh wlan hostednetwork` est **mort** (pilotes modernes ne le supportent plus). Le chemin moderne est le **Mobile Hotspot WinRT** (`Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager`, via projection PowerShell depuis l'Electron ou module natif) : SSID/passphrase configurables (`ConfigureAccessPointAsync`), activation/désactivation programmatiques. Sous-réseau ICS par défaut **`192.168.137.1/24`** (le contrat `192.168.4.1` est le cas Linux ; le client mobile prend l'hôte en **paramètre** — aucune rupture de contrat, l'Electron annonce/binder sur l'interface hotspot réelle). Requiert un adaptateur Wi-Fi compatible Wi-Fi Direct (la plupart des adaptateurs modernes).
  2. **Fallback LAN direct** : si le hotspot Windows échoue (adaptateur incompatible, politique machine), le provisioning Windows se fait **sans hotspot** — PC déjà connecté au WiFi maison, le téléphone rejoint le même LAN et envoie directement `POST /api/device-config` (flux déjà validé terrain au POC). Le hotspot reste la voie « premier boot sans écran » ; sous Windows dev, le LAN direct est la voie pragmatique.
  - Dans les deux cas : pop-up pare-feu à accepter (réseau privé), bind du serveur sur l'interface concernée.

### 6.3 Sécurité du POC (⚠️ écarté pour la v1 par le contrat mobile, §4.4)
- **Contrat v1 (10/09)** : **deux routes sans auth** (`/api/provisioning/wifi` côté hotspot isolé ; `/api/device-config` et `/api/provider-status` sur le LAN local de confiance). Le token d'appairage planifié ici devient **phase 4** (avec TLS local, rotation, owner/devices).
- **Invariants qui restent de mise** dès la v1 : mot de passe WiFi jamais dans réponses/logs/erreurs ; storage WiFi **sécurisé** (`safeStorage`) ; provisioning fermé après usage ; `maskedKey` jamais une clé réelle.
- **Credentials provider** (OpenClaw…) : acceptés une fois côté local, **jamais réémis** en clair sur le LAN.
- Bound du service au **LAN** (pas d'exposition WAN), port dédié.
- `fs.watch` sur `userData` OK (Windows) ; sinon polling 2 s.

### 6.4 Threading `onnxruntime-web` (wake word) — **corrigé le 18/09/2026**
- ~~En Electron, le serveur Next local n'a pas de cross-origin isolation → threaded wasm HS.~~ **FAUX** : `next.config.ts` envoie déjà `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (ajoutés pour WebXR/SharedArrayBuffer). Vérifié le 18/09 en interrogeant le serveur standalone packagé (`release\win-unpacked\...\server.js`) : les deux en-têtes sont bien présents → **`crossOriginIsolated === true`** dans le renderer.
- **Décision** : réutiliser tel quel le setup ORT de la référence web — import dynamique `onnxruntime-web/wasm`, artefacts self-hostés `public/ort/ort-wasm-simd-threaded.{mjs,wasm}`, `ort.env.wasm.wasmPaths = "/ort/"`, `numThreads: 1` (déterminisme ; threads multiples possibles puisque isolé). **Pas** de build single-thread à chercher.
- Le reste du §6.4 (inference ~0,25 ms/frame côté node, budget 80 ms) reste valable.

### 6.5 Micro du wake word
- `getUserMedia` fonctionne en Electron **sans popup** la plupart du temps (page de confiance).
- Deux points à tester sous Windows : **conflit d'exclusivité micro** avec d'autres applis ; et **deux flux simultanés** (wake word + voix live) → **partager le même `MediaStream`** via `lib/speech/microphone.ts` existant (ne pas ouvrir un second flux).
- Le **TTS de réponse repart via le relais holo déjà en place** (fenêtre principale → `postMessage` → `/hologram` joue + lip-sync RMS pendant que la fenêtre principale est minimisée en tray). **Zéro friction** : le wake word appelle le même chemin `handleTtsForHologram`. Le **chime** de confirmation, lui, peut jouer dans la fenêtre principale.

### 6.6 Captive portal / mDNS / isolation des routeurs
- iOS/Android ouvrent la page « captive » en se connectant au hotspot → il faut répondre `200` aux sondes (`/generate_204`, `captive.apple.com`, etc.) ou **URL manuelle** en fallback.
- Certains routeurs font de l'**isolation client** → garder le **QR avec l'IP** + « saisir l'IP à la main » en second plan.
- mDNS parfois capricieux → `jarvis.local` + IP en fallback.

### 6.7 Recovery (appliance sans écran)
- Téléphone perdu/cassé → il faut un chemin de réassociation : ex. **maintenir le bouton × 10 s → mode provisioning**, ou accès direct sur l'écran principal (le LKG affiche la config ?) au premier setup.
- Prévoir un **état de réinitialisation** propre (remise à zéro pairing + retour du hotspot).

### 6.8 Chaîne de build/sign/update Linux
- Build **obligatoirement sur Linux** (AppImage/.deb, x86_64).
- Signature (optionnel au POC, à planifier) + **auto-update** (compatible electron-builder target `AppImage` → `update-server` ou repo GitHub Releases).

### 6.9 Mobile : stack choisie + preview 3D (décision 30/08/2026)
- **Choix techno : React Native (Expo, managed workflow)** — **pas Flutter**. Raison décisive : le pipeline avatar (~5 000 lignes testées de three.js/VRM dans `lib/avatar/`) s'exécute **tel quel** via `expo-gl` ; Flutter imposerait une réécriture totale du pipeline 3D en Dart. Toute la pile produit reste en **TS/React** (web + Electron + mobile partagent `lib/avatar/`, `lib/storage/`, zustand).
- **Builds** : **Android** via `eas build -p android` → **APK** (direct) et **AAB** (Play Store) ; **iOS** → **IPA** via **EAS Build cloud (sans Mac)**, distribution App Store/TestFlight avec compte Apple (99 $/an). Développement de l'app sur device via **Expo Go** (zéro build).
- **Ce qu'on porte** (config UI, ~4/10) : panneau « Character » de `ChatPanel.tsx` (nom, pronoms, personnalité), humeur (`MOOD_OPTIONS`), couleur alcove (`HEX_COLOR_PATTERN`), choix VRM (document-picker + upload binaire), + **nouveau picker d'animation** (la liste existe déjà dans `animationOptions.ts`, pas d'UI web). Les validateurs de `lib/storage/*` sont du TS pur → reproduits tels quels.
- **Preview 3D (difficulté ~6/10, faisabilité 8/10 — c'est le « waou » démo)** : port du **noyau** d'`AvatarScene.tsx` (scène, lumières, `GLTFLoader` + VRM + choration, `environmentLoader` pour l'alcove en direct, mood, animations) sur **`expo-gl` + three** ; on **jette** la partie exécutive LKG (webxr polyfill, `VRButton`, `hologramWindow`, HLD shadow compositor, événements fenêtre) et on la remplace par « preview perspective » + drag rotation (`PanResponder` + `modelDragRotation`). Assets servis par l'Electron sur le LAN (`fetch`). Plan de repli si MToon/WebGL2 foire : **snapshot live** renderé par l'Electron renvoyé en image.
- **Attention build native** : permissions **LAN** — iOS `NSLocalNetworkUsageDescription` (« app would like to find and connect to devices… »), Android `NEARBY_WIFI_DEVICES`/mDNS ; caler le color picker (pas de `<input type="color">` natif RN) et `react-native-document-picker` pour le `.vrm` tôt.
- **Périmètre exclu du mobile** : `ChatPanel` exécutif (streaming/micro/wake word — reste dans l'Electron), `OnboardingModal` providers/credentials (**secrets au desktop, jamais sur le téléphone**), tous les modules `lib/speech`, `lib/llm`.
- **Note** : pas besoin de porter les 31 commits web pour le POC mobile — juste le contrat d'API §4 + les setters déjà existants côté Electron.

### 6.10 Chemins officiels bridge (vérifiés 30/08/2026)
- **Looking Glass Bridge (runtime) — Linux ✓** : téléchargeable page officielle (bouton « Linux Download » → `https://look.glass/bridge-linux`) ; v2.6.3 en `LookingGlassBridge-2.6.3-Ubuntu.sh` (installer : `chmod +x` ; `./`.sh) ; doc « Looking Glass Bridge … is available for Windows, MacOS (M1/Intel) and **Linux-based systems** » + page dédiée « Display Settings on Linux ». **Contrainte : X11 requis, Wayland non supporté** (confirmé aussi par le README du SDK natif).
- **bridge-sdk-samples** (`github.com/Looking-Glass/bridge-sdk-samples`) : SDK **natif** (C++/C#), headers dans `BridgeRuntime/`, samples CMake/GLFW ; requis pour le « bridge natif » Win/Mac ; même note X11/Wayland. Le Bridge installé fournit les libs requises.
- **bridge.js** (`github.com/Looking-Glass/bridge.js` → npm `@looking-glass/bridge`, MIT) : client **JS via websocket localhost** vers Bridge 2.2+. **OS-indépendant**. C'est **le `@looking-glass/bridge` déjà embarqué** dans l'app Electron (`^0.0.8-alpha.4`) → valider la compat avec Bridge 2.6.3, éventuellement bump vers la version officielle stable.
- **Bridge-Python-SDK** (`github.com/Looking-Glass/Bridge-Python-SDK`, MIT) : `pip install bridge-python-sdk` ; **wheels Windows (x86-64), macOS (universal2), manylinux (x86-64/arm64)** ; **le driver Bridge est embarqué dans le wheel** → `pip install` + OpenGL + quilt + X11. Exemples inclus ; bémol documenté : sample *video* « not at full speed » (sans impact pour la scène 3D temps-réel). = le **fallback Python officiel** (plus besoin de bridge Python artisanal).
- **Looking Glass Go (USB-C unique)** : conforme au design « que le LKG en USB-C 3.2 » — le câble transporte power + video ; à confirmer comme affichage DRM sous Linux (Phase 1).

### 6.11 Fabrication des unités (image dorée + provisioning)
- **Schéma de production** : **image dorée pour l'usine + script versionné pour la fabriquer**, et **provisioning par unité pour l'individualisation**.
  1. Valider le pipeline UNE fois (avec un écran) : install OS + drivers + Xorg + Bridge 2.6.3 + app Electron + services ;
  2. Générer l'**image dorée** (Clonezilla/rescuezilla) depuis l'unité de référence ;
  3. Chaque unité : **flash image → boot → provisioning (hotspot + téléphone)** fournit Wi-Fi + appairage + `device_id` → **plus jamais d'écran** ;
  4. SSH couvre le dépannage.
- **Pièges** : **jamais cuire le Wi-Fi perso, les tokens ou les secrets dans l'image** (tout est fourni au premier boot par unité) ; l'image suppose un **hardware identique** (changer de mini-PC → régénérer) → d'où le script versionné conservé.
- **Reco Linux : Ubuntu 24.04 LTS, session X11** (pas Wayland : tray/appindicator + fenêtres plein écran fiables), **GPU Intel/AMD intégré** (éviter NVIDIA), NetworkManager (nmcli) + avahi par défaut. Version **appliance minimale** pour l'image : Ubuntu Server + `xorg openbox tint2 xinit dbus` (tint2 héberge le tray où l'app se cache). Tester d'abord en Ubuntu Desktop (GNOME, X11) pour le debug, puis slimmer l'image dorée. **Vigilance hardware** : le port USB-C du mini-PC doit supporter **DisplayPort Alt Mode**, sinon aucune image possible.

---

## 7. Mémento technique (à garder sous la main)

- **Standalone** : `afterPack` copie `.next/standalone` → `resources/next/standalone` ; `resolveStandaloneDir({appPath, resourcesPath})` retourne `resources/next/standalone` si `appPath` absent.
- **userData** : `%APPDATA%\liteforms-web` (localStorage/IndexedDB par origine).
- **Relais holo** : `postMessage` avec origine `hologramMessageOrigin` ; protocole dans `lib/avatar/hologramMessageProtocol.ts` ; frames RMS via `lipSyncEvents.ts`/`createRmsLipSyncFrame`.
- **Cross-window config** : événement `storage` (même origine) — utilisé pour l'alcove ; `saveEnvironmentConfig` → l'événement `storage` déclenche dans `/hologram`.
- **Bridge natif** : `electron/nativeBridge.ts` spawn `nativeBridgeProbe.js` (JSON sur fd 3) ; calibration par `applyNativeLookingGlassBridgeCalibration`. Pattern réutilisable pour un probe Python sous Linux.
- **Looking Glass — cadrage** (piège vérifié terrain 17/09) : la **taille apparente** du sujet ne dépend **que** de `targetDiam`, jamais de la distance caméra. Le polyfill dérive `orbitDistance = 0.5 × targetDiam / tan(fovy/2)` et notre `fovy` est dérivé de la distance (`withLookingGlassCameraPose`), donc **déplacer la caméra s'annule à l'écran**. Zoom un jour = `targetDiam / zoom` (c'est ce que fait la molette du polyfill, `webxr.js:491`) ; rotations et profondeur = transforms de scène, donc toujours visibles. Règle générale : sur LKG, exprimer les réglages visuels en **paramètre de scène**, pas en mouvement de caméra.
- **`avatar.pose`** : 4 champs **tous relatifs à une base capturée** (yaw naturel du modèle/alcôve, position cadrée, distance de cadrage) → la pose neutre `{0,0,1,0}` restaure toujours le rendu par défaut de l'appliance. Logique pure dans `lib/avatar/avatarPose.ts`, store `liteforms.poseConfig`, propagée à `/hologram` par l'événement `storage`. Contrat : `protocol/DEVICE_API.md` §Bloc `avatar.pose`.
- **Bridge Linux (official)** : looking-glass-bridge 2.6.3 `.sh` (X11) → `https://look.glass/bridge-linux` ; chemin JS via websocket localhost (`@looking-glass/bridge`, 0 ligne à écrire) ; fallback `pip install bridge-python-sdk` (wheels manylinux).
- **Mobile** : `eas build -p android` → APK/AAB ; `-p ios` → IPA via EAS cloud (compte Apple pour disctribution/TestFlight) ; preview 3D = `expo-gl` + three + noyau `lib/avatar` ; assets servis par l'Electron sur le LAN.
- **Nommage commits** : `Jarvis: <sujet anglais descriptif>`.
- **Règles** : **jamais de push** sans accord ; ne rien supprimer ; demander en cas de doute ; commit seulement sur demande explicite (miroir).
- **Tests de non-régression** : `npm test`, `npm run lint`, `npx tsc --noEmit` (ignorer les erreurs pré-existantes listées §1.3), puis `npm run build:electron:main` / `npm run dist:electron`.

---

## 8. Backlog des prochaines actions concrètes

**Portage (workspace `C:\dev\liteforms-electron`)**
- [x] ~~Portendre 22 (strip markdown) + 25/26/28/29 (parser + timers + function calling), groupe « logique pure ».~~ **FAIT (17/09, non validé terrain)** : strip markdown (dédup `getSafeTextForTts`), parser `calculate` (`%` de la base), `lib/timer/` + `timerStore`, catalogue d'outils + registre, câblage adaptateurs + `ChatPanel`, chime. Détail : §13.
- [ ] Port `6`/`7` (retunes Alacove/hips) dans la scène Electron + `/hologram`.
- [ ] Port `19`/`20` (conversation ids OpenClaw) puis `2`.
- [ ] Port `9` (emotion : `moodConfig` + controller + UI).
- [ ] Port du wake word `11`→`17` (bundles + UI + cue + config), build **single-thread** ort (§6.4), partage du `MediaStream` micro (§6.5).
- [ ] À chaque groupe : tests + lint + tsc + build.

**Appliance / POC config**
- [x] ~~**Prioritaire** : week-end Phase 1 — Bridge 2.6.3 sur Ubuntu 24.04 X11, bascule du probe natif → websocket JS, énumération DRM du LKG Go en USB-C, build AppImage/.deb sur Linux.~~ **FAIT + validé terrain 17/09/2026** : LKG Go énuméré (DRM : 720x1280 logique / 1440x2560 physique), probe natif OK in-process (daemon Bridge **non requis**, bascule websocket **abandonnée**), AppImage OK (pas de `.deb` par conception). Preuves : `PLAN_LINUX_BRIDGE.md` §7 — ⚠️ **réserve** : le daemon LGB était installé sur l'appliance pendant le test → statut réel à vérifier (`PLAN_LINUX_BRIDGE.md` §8).

**Contrat mobile v1 (app mobile prête, §4.4, ordre du contrat)**
- [x] Hotspot temporaire `Liteforms-Setup-XXXX` + service provisioning sur `192.168.4.1:8080` (port = paramètre de config Electron, défaut 8080, annoncé dans `provisioning/health` — §4.3). **FAIT (13/09/2026)** : `electron/wifi/` — hotspot WinRT Windows validé terrain (gateway `192.168.137.1`), Linux nmcli implémenté (helper privilégié §6.2 restant à valider terrain), fallback LAN-direct automatique.
- [x] **Variante Windows du provisioning (fonctionnelle, §6.2)** : hotspot WinRT (`192.168.137.1`) ou fallback LAN direct — mêmes routes contrat v1. **FAIT + validé terrain 13/09/2026** (start/stop/join échec propre ; pattern AsTask obligatoire, voir §13).
- [x] `GET /api/provisioning/health`. **FAIT (13/09/2026)** — serveur dédié main process, actif uniquement en mode provisioning.
- [x] `POST /api/provisioning/wifi` + stockage WiFi sécurisé (`safeStorage`) + transition vers le WiFi cible (Linux `nmcli` / Windows profil WLAN) + fermeture du mode provisioning. **FAIT (13/09/2026)** — persistance AVANT arrêt hotspot ; relance auto après acceptation ; join Windows à retester avec réseau réel (netsh wlan connect exige l'autorisation de localisation Win11).
- [x] `GET /api/health` (réseau normal, `networkMode`, `configVersions`). **FAIT (13/09/2026)** — `networkMode` via `LITEFORMS_NETWORK_MODE` décidé par la machine à états.
- [x] ~~API `POST /api/device-config` (v1 sans token, idempotent, champs inconnus ignorés) + `GET /api/provider-status` (statuts masqués).~~ **FAIT (17/09, non validé terrain)** : `device-config` durable déjà en place ; `POST /api/credentials` + `GET /api/provider-status` ajoutés (clé via fichier + IPC, jamais servie). Détail : §13.
- [ ] `indexedDbVrmRepository` : `list()`/`loadByName()` (le payload n'a que `fileName`/`id`, `hash` nullable).
- [ ] `applyDeviceConfig()` (réutilise setters + remontage ChatPanel) + événement live (polling d'abord).
- [x] Port commit 9 (mood) et ports 6/7 (pose) nécessaires au champ `avatar.*` (mapping §4.4). **FAIT** : mood `e402db0` (validé terrain), pose implémentée 17/09 (`avatarPose.ts` + `poseConfig.ts` + `AvatarScene`, validation terrain à faire).
- [x] Serveur Next en écoute LAN + gestion pare-feu (test Windows puis Linux). **FAIT (13/09/2026, Windows)** — bind `0.0.0.0` par défaut en mode normal (`wifi`/`ethernet`) depuis 13/09 via `resolveServerHost()` ; provisioning reste loopback ; `LITEFORMS_SERVER_HOST` explicite prioritaire ; pare-feu 43178 déjà géré (NSIS + win-unpacked).

**App mobile (Expo/React Native — ✅ PRÊTE, contrat `docs/contract` verrouillé, rien à faire côté mobile)** ce bloc devient un rappel de l'existant :
- ✔️ Écrans config + provisioning (réglages WiFi système, iOS = instruction + ouverture réglages).
- ✔️ Découverte : IP manuelle d'abord, mDNS ensuite.
- ✍️ à arbitrer plus tard (hors contrat v1) : preview 3D (`expo-gl` + noyau `lib/avatar` — la question MToon/WebGL2 de §6.9 reste vraie si un jour on la veut).

**Kiosque Linux (plus tard)**
- [ ] Build AppImage/.deb sur Linux, autostart, mDNS, provisioning hotspot (nmcli + polkit), pairing complet, auto-update (Phases 3–4).
- [ ] Fabrication : image dorée + script versionné + provisioning par unité (jamais de secrets/Wi-Fi dans l'image, §6.11).

---

## 9. Synthèse des chiffres

| Élément | Difficulté | Faisabilité |
|---|---|---|
| Portage global web→Electron | cumulée 2→7 selon les blocs | 9/10 |
| API config téléphone (POC) | 3–4/10 | 9–10/10 |
| Live apply (sans reboot) | 2/10 | 10/10 (settlers existants) |
| Provisioning hotspot + pairing | 5–6/10 | 9/10 |
| **Holo sur Linux (chemin officiel — §6.1/§6.10)** | **3–4/10** | **9,5/10** |
| **Mobile config UI (Expo)** | **4/10** | 9–10/10 |
| **Mobile preview 3D (expo-gl)** | **6/10** | **8/10** |
| Sécurité durcie (phase 4) | 3/10 | 9/10 |
| App mobile (hors Electron) | projet séparé | 2–3 semaines d'agent |

**Risques actualisés (30/08/2026)** : le driver LKG sous Linux n'est **plus** un pari (chemin officiel) — reste l'**énumération USB-C du LKG** et la meta de l'**image dorée**/hardware. Risque n°2 conservé : robustesse privilèges Wi-Fi. **Piège de portée** : 3 projets imbriqués → POC strict = Phase 1 + Phase 2.

---

## 10. Post-mortem provisioning WiFi contrat v1 (13/09/2026)

* **Fait/validé** : routes provisioning (`electron/wifi/provisioningServer.ts`, main process, port configurable, actives UNIQUEMENT en mode provisioning), machine à états (`provisioningService.ts`, persistance AVANT arrêt hotspot, idempotente), stockage `safeStorage` (`wifiCredentialsStore.ts`), `networkMode` dans `/api/health`. Tests : 766 verts, lint 0 erreur, tsc OK.
* **Validé terrain Windows** : hotspot WinRT réel start→stop (SSID `Liteforms-Setup-XXXX`, gateway ICS `192.168.137.1`), via le code compilé (`scripts/provisioning-live-check.cjs`).
* **Pièges découverts** : (1) WinRT `IAsyncOperation` = `__ComObject` en PS 5.1, `.GetAwaiter()` n'existe PAS — passer par la projection `AsTask` de `System.Runtime.WindowsRuntime` (backtick dans single quotes) ; (2) le XML de profil WLAN exige `<connectionType>ESS</connectionType>` (sinon erreur schéma 0x80001 — l'ordre des éléments est forcé) ; (3) `netsh wlan connect` exige l'autorisation de localisation Windows 11 (sinon erreur 5) — la reconnexion WiFi réelle reste à tester avec un réseau présent ; (4) fichier partagé main/Next : la source canonique doit vivre sous `electron/` (contrainte `rootDir`), `lib/` ne fait que réexporter.
* **Reste** : valider le join WiFi Windows sur un réseau réel + la transition complète Mobile→hotspot→WiFi maison ; helper privilégié Linux (polkit) avant le déploiement appliance ; détection Ethernet (actuellement `wifi` par défaut après provisioning).
### Mise a jour 13/09/2026 - cycle complet valide sur Windows

* **Cycle de bout en bout PASSE** (hotspot -> POST wifi -> persistance -> stop hotspot -> join OK -> relaunch -> boot normal 
etworkMode:"wifi"). Le join WiFi Windows sur reseau reel fonctionne (SFR_29BF, WPA2PSK).
* **Incidents et fixes root-cause** (tous terrain) :
  1. SSID invisible : WinRT Band=Auto -> 5 GHz/DFS que le telephone n'affiche pas -> **forcer 2,4 GHz** (les deux plateformes) ;
  2. Pare-feu : reseau "Public" + aucune regle -> blocage silencieux (le serveur repond en local, pas depuis le LAN) -> regles NSIS a l'install, sinon instruction netsh loggee ;
  3. GET /api/health 404 sur le serveur de provisioning -> le mobile ne pouvait pas faire son health-check ; route ajoutee (
etworkMode:"provisioning") ;
  4. **Course relaunch/join** : le 202 rapide + relaunch 500 ms tuaient le process AVANT le join (log sans join result) -> le relaunch attend service.transition ;
  5. Join echoue a 0,5 s de l'arret du hotspot (pile WLAN en transition) -> **retry 0/5/10/15 s + attente d'association reelle** (§5bis.6) ;
  6. Le serveur attendait la fin du join avant le 202 (timeout mobile) -> 202 a la persistance, transition en arriere-plan.
* **Lecons qui changent le futur** : (a) sur hotspot/ICS, toute assertion "c'est en marche" doit etre verifiee cote radio (scan), pas juste API ; (b) les transitions reseau exigent des delais/retries - jamais de chaine immediate ; (c) le "fetch failed" cote mobile peut signifier un succes dont la reponse meurt avec le hotspot - distinguer dans l'UI mobile (a corriger) ; (d) tester le chemin de bout en bout AVANT de croire un etat "On".
* **Linux blinde par transposition** (commit 5f8511a) : bande bg forcee, pin 192.168.4.1/24 + detection IP reelle (bug corrige : 
mcli shared donne 10.42.0.1 par defaut), verification post-hotspot (actif + IPv4), retry join, polkit esources/linux/ pour l'image doree, ufw.
* **Reste** : refonte UX du flow (feedback appliance, messages mobile, decouverte post-provisioning mDNS jarvis.local - l'etape "ressaisir l'IP" est refusee produit) ; checklist terrain Linux §6.11 ; mobile : provisionWifi doit utiliser les coordonnees saisies, pas le store.

### Mise a jour 15/09/2026 - re-appairage manuel (reset) livre

* **Fait** : `POST /api/provisioning/reset` (protocole 15/09) — route Next mode normal
  (env `LITEFORMS_WIFI_CREDENTIALS_PATH`, purge dure unlinkSync, idempotente) + watcher
  `fs.watch` main (`electron/wifi/resetRelaunchWatcher.ts`) : fichier supprime → relaunch →
  boot v2 sans credentials → provisioning (hotspot). Mobile : œil dans le champ mot de
  passe (écran 2) + bouton « Refaire l'appairage » branché sur la route (resetProvisioning
  best-effort, echec reseau post-envoi = transition normale, jamais une erreur).
  Commits : `468bc67` (Electron), `36eef4e`/`5ecaa68` (Mobile). Tests : 807 verts
  Electron, 91 verts Mobile, tsc 0 erreur des deux côtés.
* **Lecon** : un fichier « lu au boot seulement » (piège du 13/09) exige un chemin
  d'evenement runtime pour etre purge a chaud — d'ou le watcher fs.watch filtre sur le
  nom de fichier, fire-once, arme uniquement en mode normal.
* **Reste** : cycle terrain reel du reset (appelle depuis le LAN → relaunch → hotspot
  revu par le Mobile) — au prochain cycle Windows ; degrade si fs.watch indisponible
  (purge effective, provisioning au prochain redemarrage manuel).
* **Bug 13/09 (post-provisioning, fix le jour meme)** : le bind LAN `0.0.0.0` du serveur Next etait "opt-in" POC (`LITEFORMS_SERVER_HOST`) → en mode normal l'appliance n'ecoutait que `127.0.0.1` → le scan de decouverte Mobile ne trouvait JAMAIS l'appliance, flux "zero IP" mort. Fix : bind `0.0.0.0` par defaut en mode normal, loopback en provisioning, override explicite prioritaire. **Lecon : un invariant POC "opt-in" peut devenir un bug produit — chaque defaut de POC doit etre reevalue au moment de la promotion (la difference n'est pas technique, elle est usage).**

---

## 11. Post-mortem Looking Glass Linux (17/09/2026)

* **Fait/validé terrain** : le LKG Go affiche enfin l'hologramme sur l'appliance Ubuntu 24.04 **X11** (commit `Jarvis: fix native Bridge probe on Linux and validate LKG hologram`). Preuves : `nativeBridge probe :: available=true display="Looking Glass Go" serial="LKG-E13328" 1440x2560 pos=3840,0 quilt=11x6` → `native calibration applied serial=LKG-E13328 1440x2560` → `AvatarScene model framed hologram=true` (détail : `PLAN_LINUX_BRIDGE.md` §7).
* **Incident + fix root-cause** : `libbridge_inproc.so` importe les symboles `app_indicator_*` **sans `DT_NEEDED`** appindicator → `dlopen(RTLD_NOW|RTLD_LOCAL)` échouait sur `undefined symbol: app_indicator_set_icon_theme_path`. Fix : préchargement `RTLD_GLOBAL` (chaîne mbedTLS du bundle puis `libayatana-appindicator3.so.1`) avant le `dlopen`, parité avec le SDK Python upstream ; dépendance système `libayatana-appindicator3-1` documentée (non bundle-able, licence).
* **Fiabilité du probe** : un `dlopen` à froid d'une AppImage `compression:"maximum"` (96 Mo) prend 4-7 s → timeout 7 s donnait des faux négatifs et empilait des probes. Fix : timeout 30 s + single-flight + SIGTERM→SIGKILL (2 s).
* **Décisions durables** : le daemon Looking Glass Bridge **n'est pas nécessaire** (le polyfill rend le quilt côté client, le probe natif fournit la calibration) → bascule « probe natif → websocket JS » **abandonnée** (⚠️ **non vérifié terrain** : le daemon LGB était installé pendant le test → voir `PLAN_LINUX_BRIDGE.md` §8) ; `lsusb` ne montre pas le LKG Go mais le SDK le détecte (aucune règle udev requise) ; le probe renvoie des pixels **physiques** (1440x2560) vs Electron en **logique** (720x1280, dpr=2) — écart normal, ne pas « corriger ».
* **Leçons** : (1) un `undefined symbol` en `RTLD_NOW` se règle par préchargement global, pas en changeant de transport ; (2) ne jamais caler un timeout sur le chemin lent d'un binaire — le mesurer ; (3) le bruit de log du polyfill WebXR (`Can't change size while VR device is presenting`, `uniform1fv: no array`, `assign baselayer twice?`) est pré-existant et non bloquant — ne pas partir en chasse sans symptôme visible.
* **Reste** : rien de bloquant. Points ouverts assumés en `PLAN_LINUX_BRIDGE.md` §7.4 (or cleanup du SIGKILL différé si observé, cadence du poll renderer = décision produit).
* **À vérifier (non bloquant, à faire au prochain cycle terrain)** : le `.sh` Looking Glass Bridge 2.6.3 était installé **en même temps** que le correctif sur l'appliance → le daemon LGB est-il réellement dans le circuit, ou l'installeur a-t-il seulement servi de source de paquets système ? Analyse de code : le daemon n'est pas sur le chemin (probe in-process, bounds nécessaires à l'auto-open, `.so` = moteur et non client) — mais **ce n'est pas vérifié terrain**, et ça change la liste de dépendances de l'**image dorée**. Tests A/B/C (commandes, lecture des résultats, doc à mettre à jour) : `PLAN_LINUX_BRIDGE.md` **§8**.

---

## 12. Post-mortem `avatar.pose` sur l'appliance (17/09/2026)

* **Fait/validé terrain** : la pose du Mobile (`avatarYaw`, `alcoveYaw`, `zoom`, `depth`) est appliquée **à chaud** par l'appliance, fenêtre principale **et** `/hologram` ; la réinitialisation restaure le rendu de référence. Commits : Electron `Jarvis: apply avatar.pose on the appliance (main window and hologram)` (`beb510b`), Mobile `Lock the avatar pose reset to the contract neutral values` (`8f8a727`). Contrat : `protocol/DEVICE_API.md` §Bloc `avatar.pose` (normatif, y compris l'invariant de réinitialisation). Validé par l'utilisateur sur Windows + Looking Glass réel.
* **Incident 1 — le zoom LKG était un no-op** : la taille apparente du sujet ne dépend que de `targetDiam`, pas de la distance caméra (le polyfill dérive `orbitDistance = 0.5 × targetDiam / tan(fovy/2)`, et notre `fovy` est dérivé de la distance → les deux s'annulent). Un zoom implémenté comme mouvement de caméra ne change donc **rien** à l'écran, alors que rotations et profondeur (transforms de scène) marchaient — c'est exactement le symptôme rapporté. Fix : `withLookingGlassZoom` agit sur `targetDiam` ; `computeZoomedCameraCenter` supprimée (code mort).
* **Incident 2 — `alcoveYaw` appliqué en absolu** : `alcove.rotation.y = pose.alcoveYaw` écrasait l'orientation naturelle de l'alcôve (`environmentLoader` ne copie que `scale`/`position`), donc « Réinitialiser » n'aurait pas restauré le rendu de référence — précisément le risque signalé par le produit. Fix : capture de `baseAlcoveYaw` au chargement, application en relatif, test avec bases non nulles.
* **Leçons** : (1) **sur Looking Glass, exprimer tout réglage visuel en paramètre de scène (`targetDiam`, transforms), jamais en mouvement de caméra** — sinon effet nul et invisible en test unitaire ; (2) tout champ de pose doit être **relatif à une base capturée**, sinon le reset perd la référence (l'appliance et le Mobile ne rendent pas pareil, donc aucune valeur ne doit être « en dur » d'un côté) ; (3) `typeof value === "number"` laisse passer `NaN`/`Infinity` — `Number.isFinite` obligatoire à la frontière de confiance ; (4) le bouton « Réinitialiser » du Mobile doit être verrouillé par un test **sur les littéraux du contrat**, pas sur la constante locale.
* **Reste** : rien de bloquant pour cette feature. Le trou connu : le test Mobile reproduit l'appel exact de `resetPose` mais ne monte pas le composant (pas de renderer RN installé) — à fermer si un harnais de rendu arrive.

---

## 13. Post-mortem — config providers + clés API + outils voix (17/09/2026, NON validé terrain)

* **Fait (Electron)** : `POST /api/credentials` + `GET /api/provider-status` (routes qui manquaient) ; clés stockées dans `<userData>/config/provider-credentials.json` (même mécanisme que device-config), relues par le renderer via un **IPC preload** (`electron/credentials.ts` + `lib/credential/credentialBridge.ts`) injecté dans `config.credential` aux points d'appel des adaptateurs — **une seule source de vérité** (le `CredentialSettingsPanel` desktop écrit au même endroit). Redaction étendue (champ `credential` masqué dans les diagnostics). Modèles manquants ajoutés (`gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, +4 STT OpenAI).
* **Fait (Mobile)** : écran providers refait — **rien de pré-activé** (état `"none"`), cascade provider→modèle/voix/clé, `requiresKey` par provider, clé **transitoire** (jamais persistée) envoyée via `postCredential`, `provider-status` affiché. `serializeDeviceConfig` refuse `"none"`, `review` bloque l'envoi tant qu'un slot est vide.
* **Fait (portage voix, propre)** : catalogue d'outils unique + registre (7 outils, hors `openclaw_web_search`), timers, chime (module dédié, son identique), strip markdown, parser `calculate` avec `%` de la base. Dette web éliminée : définitions d'outils dupliquées par provider, `if/else` de 50 lignes dans `ChatPanel`, singleton `TimerManager`, `CustomEvent` DOM, `localStorage` dans la classe métier, double validation du parser, `"1.2.3"` accepté en silence.
* **Leçon (frontière serveur/renderer)** : les routes Next (serveur) ne peuvent pas écrire l'IndexedDB du renderer → la clé vit côté main process (fichier) et remonte par IPC, jamais servie en HTTP (même loopback). La frontière POC §13.3 reste l'invariant structurant.
* **Leçon (clé en clair)** : le fichier est en clair (comme device-config, pas `safeStorage` comme le WiFi). Invariant tenu = « jamais servi / jamais loggé », pas « chiffré au repos ». Migration `safeStorage` = Phase 4 (§13.6).

### 13.1 À valider sur le terrain (retours attendus)

1. Écran providers démarre **vide** (`none`), rien de pré-rempli.
2. Cascade : choisir un provider révèle modèle/voix/clé et cache le reste ; la clé n'apparaît que pour les providers à clé.
3. Envoi : `device-config` (sans clé) puis `POST /api/credentials` par provider distinct.
4. `provider-status` renvoie `configured` + `sk-****` — jamais la clé.
5. **Le test qui compte** : l'assistant parle avec la vraie clé et le bon modèle (un appel fournisseur réussit ; sinon, le log doit montrer `credential` **masqué**, jamais en clair).
6. Voix temps réel : outils (heure, date, calcul, timers) répondent ; le timer déclenche chime + annonce.
7. Strip markdown : un lien n'est ni épelé à voix ni affiché en URL.

### 13.2 À trancher (décisions produit en attente)

1. **Clé au repos** : clair (actuel) vs `safeStorage` chiffré → Phase 4.
2. **Dédup clé par famille** : `openai` et `openai-realtime` demandent la même clé deux fois (dédup par id, pas par famille). Améliorable si gênant.
3. **Aspect final de l'écran providers** : l'utilisateur le trouve « mieux » mais pas pleinement satisfait de la finition → passe de polish UI à prévoir (hiérarchie, groupement, états vides).
4. **Token OpenClaw** : toujours non lu automatiquement (reste au plan §7.1) ; le Mobile ne demande pas de clé pour openclaw (cohérent avec le protocole).
5. **Sémantique `configured`** : « une clé existe pour le provider courant du slot » (pas « testée/réussie ») — à confirmer.

### 13.3 Reste

* Validation terrain ci-dessus, puis ajustement éventuel de la granularité des commits.
* Tests Electron **1005** / Mobile **186**, `tsc`/lint/build OK — mais **zéro validation terrain** à ce stade (l'utilisateur ne peut pas tout tester ce soir).

---

## 14. Post-mortem — parité providers realtime + voix Mobile (18/09/2026, validé terrain)

* **Fait (Mobile)** : l'écran providers **effondre TTS/STT** quand le LLM est realtime (`openai-realtime`/`google-live`) — seuls provider/modèle/voix/endpoint/clé restent (parité web `OnboardingModal`) ; la revue affiche « Inclus dans <label> », la gate d'envoi ignore TTS/STT, et les slots restés `none` partent remplis des défauts web (`kokoro`/`distil-whisper`, sans clé) pour respecter le contrat wire à trois slots ; les clés proposées sont limitées au LLM.
* **Fait (Electron)** : `mapPocProvidersToEndpoints` applique désormais `providers.llm.model` **et `providers.llm.voiceId`** à `realtimeVoice` (la voix choisie sur le Mobile traversait le contrat mais était **jetée au mapping** → l'appliance jouait `coral`/`Kore` en dur, c'est le bug entendu) ; instrumentation diag des appels d'outils (`realtime tool-call/tool-result/tool-error`) et des expirations (`timer expired … session=…`) ; log trompeur `live-audio forwarded bytes=0` corrigé (artefact du transfert `postMessage(..., [bytes])`, taille capturée avant envoi).
* **Contrat** : `protocol/DEVICE_API.md` §`POST /api/device-config`, encadré « Providers realtime (18/09/2026) » (`llm.voiceId` = voix realtime ; `tts`/`stt` ignorés).
* **Validé terrain (Windows, win-unpacked)** : config realtime poussée sans TTS/STT, voix **alloy** appliquée, outils voix heure/date/calcul/timers OK (confirmation utilisateur ; logs outillés désormais disponibles pour audit).
* **Reste / différé** : mismatch latent `endpoint: null` (le type Mobile l'autorise, `isProviders` Electron exige une string) — non déclenché tant que l'endpoint n'est pas vidé. **Leçon** : pour un portage, vérifier que la donnée **arrive ET est consommée** côté cible, pas seulement qu'elle est envoyée.

---

## 15. Portage wake word « Hey Jarvis » (OpenWakeWord) — phase 1 validée terrain (18/09/2026)

* **Tranche 1 (faite, validée)** : bundle autonome `bundles/wakeword/` (moteur ORT + controller + store zustand + hook + panneau POC), page `/poc-wakeword`, assets self-hostés (`public/models/wakeword/` 6 `.onnx`, `public/ort/ort-wasm-simd-threaded.{mjs,wasm}`, `public/worklets/pcm-worklet.js`), `features.json` + `lib/core/featureFlags.ts`. Port fidèle de la référence web (`bundles/wakeword/`, plan `Plan d'implémentation.md`), 1036 tests verts, `/poc-wakeword` compilé et packagé. **Détection « Hey Jarvis » validée par l'utilisateur** (Chrome sur le serveur packagé).
* **Correction au passage** : §6.4 — COOP/COEP déjà en place, ORT threaded self-hosté réutilisé, aucune chasse au build single-thread.
* **Reste** : tranche 3 = intégration ChatPanel (bridge, **un seul** `getUserMedia` partagé, mode exclusif, STT auto sur détection, réglage « Wake word » persistant) ; tranche 4 = cue alcôve + greeting adapté à l'animator Electron (`VrmRuntimeAnimator`, pas d'`idleChoreographer`).
* **Note** : portage mono-repo — la référence web n'a pas été modifiée.
