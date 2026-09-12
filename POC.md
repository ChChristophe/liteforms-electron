# POC Mobile -> Electron sur le LAN

> Etat : **TERMINE ET VALIDE SUR LE TERRAIN (12/09/2026)** — Phases A, B et C
> reussies de bout en bout (voir §12 et §13). Phase D remplacee par la
> direction produit §7.1. Enseignements et reprise en architecture finale :
> §13.
> Date initiale du plan : 10/09/2026. Validation terrain : 12/09/2026.

## 1. But

Prouver, sans traiter le provisioning WiFi, qu'un telephone et Electron sur le
meme reseau peuvent :

1. envoyer une configuration complete ;
2. la recevoir, la valider et la conserver ;
3. l'ecrire provisoirement dans le `localStorage` du renderer Electron ;
4. l'appliquer a chaud a l'avatar et au ChatPanel ;
5. lire des donnees exposees par Electron, notamment la liste des VRM ;
6. lire l'etat des providers et, dans un scenario explicitement opt-in, le
   token OpenClaw local.

Le POC doit d'abord fonctionner sous Windows. Il ne depend ni de Linux, ni de
`nmcli`, ni du hotspot, ni de mDNS, ni d'une app Electron redemarree pour chaque
changement.

## 2. Ce qui est deja decide

- Le contrat Mobile v1 est dans
  `C:\dev\Liteforms-Mobile-Application\docs\contract\`.
- Le Mobile est pret ; le travail restant est cote Electron.
- La configuration envoyee suit `POST /api/device-config`, version `1.0`.
- Le LAN est considere de confiance en v1 ; il n'y a pas encore de token
  d'authentification.
- `device-config` ne contient aucun secret provider ni token de pairing.
- Les cles provider vivent cote Electron. Une future saisie depuis le Mobile
  serait une route dediee `POST /api/credentials`, pas `device-config`.
- Le provisioning WiFi (`/api/provisioning/*`) est hors de ce POC.
- La configuration doit etre appliquee sans afficher de menu, QR code ou code
  sur l'appliance ; l'affichage reste reserve a l'avatar.

## 3. Contraintes techniques du repo

### 3.1 Origine et port

La version packagée utilise actuellement :

```text
Renderer Electron : http://127.0.0.1:43178
Stockage          : localStorage + IndexedDB, par origine Chromium
```

Le serveur doit devenir joignable depuis le LAN sans changer l'origine locale
du renderer. Ne pas remplacer `43178` par `8080` dans ce POC : cela recreerait
un changement d'origine et risquerait de rendre les reglages existants
invisibles. Le contrat final garde `8080` comme port de provisioning
configurable ; ce sera une decision d'integration ulterieure.

Le POC doit donc :

- conserver le serveur Next et son port fixe `43178` pour le renderer ;
- lier le serveur au LAN de facon controlee (adresse locale explicite ou
  `0.0.0.0`, seulement apres validation du pare-feu) ;
- faire utiliser au Mobile `http://<IP-Electron>:43178` ;
- ouvrir uniquement le profil reseau prive Windows pour le test ;
- ne jamais exposer le serveur sur Internet.

### 3.2 Frontiere serveur / renderer

Le serveur Next n'a pas acces au `localStorage` ni a l'IndexedDB du renderer.
Le flux doit donc etre explicite :

```text
Mobile
  -> POST /api/device-config
Next local
  -> conserve le dernier payload POC et renvoie un accuse
Renderer Electron
  -> poll GET /api/poc/pending-config
  -> valide l'enveloppe
  -> localStorage.setItem("liteforms.poc.deviceConfig", payload)
  -> applique les setters existants
```

Pour le POC, le dernier payload peut rester en memoire dans le serveur Next.
C'est volontairement non durable : la persistance cible sera un fichier de
configuration durable dans `userData`, puis le chemin main/IPC prevu par le
plan directeur. Le `localStorage` du renderer sert ici a prouver la reception
et l'application, pas a definir le stockage final du device.

Le polling est prefere a un nouveau canal IPC pour le premier test : il reduit
le nombre de pieces et prouve le flux LAN de bout en bout. Un evenement IPC
pourra remplacer le polling apres validation.

## 4. Payload de configuration

Le corps de `POST /api/device-config` doit reprendre le contrat Mobile, sans
ajouter de credential :

```json
{
  "configVersion": "1.0",
  "character": {
    "name": "Clawdia",
    "pronouns": "SHE",
    "personality": "Curieuse et taquine.",
    "greeting": "Salut !"
  },
  "avatar": {
    "mood": "happy",
    "modelRef": {
      "id": "lobsterEdit",
      "fileName": "lobsterEdit.vrm",
      "hash": null
    },
    "pose": {
      "avatarYaw": 0,
      "alcoveYaw": 0,
      "zoom": 1,
      "depth": 0
    }
  },
  "environment": {
    "alcoveColor": "#4a90d9"
  },
  "providers": {
    "llm": {
      "provider": "openai",
      "model": "gpt-5.5",
      "endpoint": "https://api.openai.com/v1",
      "voiceId": null
    },
    "tts": {
      "provider": "elevenlabs",
      "model": "eleven_flash_v2_5",
      "endpoint": "https://api.elevenlabs.io/v1",
      "voiceId": "CwhRBWXzGAHq8TQ4Fs17"
    },
    "stt": {
      "provider": "deepgram",
      "model": "nova-3",
      "endpoint": "https://api.deepgram.com/v1",
      "voiceId": null
    }
  }
}
```

Regles de reception :

- accepter uniquement `configVersion: "1.0"` ;
- rejeter les champs obligatoires absents ou de mauvais type ;
- ignorer les champs inconnus ;
- ne jamais journaliser le payload brut ;
- ne jamais accepter `credential`, `apiKey`, `token` ou `password` dans ce
  payload ;
- rendre la requete idempotente ;
- renvoyer `warnings` pour une partie non encore supportee, plutot que perdre
  silencieusement la configuration.

## 5. Routes du POC

### 5.1 Routes contractuelles

Ces routes doivent rester compatibles avec le README distant :

| Route | Fonction POC |
|---|---|
| `GET /api/health` | annoncer `protocolVersion`, `configVersions` et `networkMode` |
| `POST /api/device-config` | recevoir, valider et mettre en attente la configuration |
| `GET /api/provider-status` | retourner uniquement `configured` et `maskedKey` |

Reponse d'acceptation attendue :

```json
{
  "ok": true,
  "configVersion": "1.0",
  "appliedAt": "2026-09-10T15:30:00Z",
  "warnings": []
}
```

Dans la premiere version, `appliedAt` signifie « payload recu et mis en
attente ». Il ne doit etre declare applique qu'apres l'ecriture dans le
`localStorage` du renderer et l'execution des setters.

### 5.2 Routes strictement POC

Elles sont hors contrat Mobile v1 et doivent rester prefixees `/api/poc/` :

| Route | Fonction |
|---|---|
| `GET /api/poc/pending-config` | permettre au renderer de recuperer le dernier payload recu |
| `GET /api/poc/state` | retourner un resume non secret de la config actuellement appliquee |
| `GET /api/poc/vrms` | retourner les metadonnees des VRM disponibles localement |
| `GET /api/poc/openclaw-status` | retourner endpoint, provider et statut masque |
| `GET /api/poc/openclaw-token` | scenario diagnostique opt-in uniquement, voir §8 |

Ces routes ne doivent pas etre presentees comme un contrat de production.

## 6. Application cote Electron

### 6.1 LocalStorage POC

Le renderer ecrit le payload accepte sous une cle dediee :

```text
liteforms.poc.deviceConfig
```

Ne pas reutiliser directement `liteforms.sessionConfig` pour le payload brut :
le contrat Mobile (`stt`, `endpoint`, `voiceId`, `avatar`, `pose`) ne correspond
pas exactement aux types internes (`asr`, `baseUrl`, `credential`, etc.).

Apres validation, le renderer peut projeter les sous-parties vers les stores
existants :

| Bloc recu | Projection POC |
|---|---|
| `character` | `saveCharacterConfig()` puis `setCharacter()` |
| `environment.alcoveColor` | `saveEnvironmentConfig()` puis setter existant |
| `providers` | mapping `stt -> asr`, `endpoint -> baseUrl`, puis `saveSessionConfig()` |
| `avatar.modelRef` | recherche locale du VRM par `fileName` / `id` |
| `avatar.mood` | warning tant que le port mood n'est pas integre |
| `avatar.pose` | warning tant que les ports pose ne sont pas integres |

Le `ChatPanel` doit etre remonte par `chatPanelKey` apres modification des
providers, comme le fait deja `app/page.tsx` pour la configuration initiale.
Les valeurs sensibles ne doivent jamais etre recopiees dans le payload POC ni
dans les logs.

### 6.2 VRM

Le repo actuel ne conserve qu'un enregistrement VRM courant dans IndexedDB
(`liteforms-vrm`, cle `current`) via `indexedDbVrmRepository`. Le POC doit
donc :

- retourner au minimum le VRM courant (`id`, `fileName`, `hash: null`) ;
- ajouter ensuite `list()` / `loadByName()` si plusieurs VRM doivent etre
  exposes ;
- ne retourner que des metadonnees, jamais le binaire dans la liste ;
- appliquer `modelRef` uniquement si le fichier local existe ;
- renvoyer `MODEL_REF_UNKNOWN` ou un warning explicite sinon ;
- ne pas ajouter d'upload VRM au POC LAN.

### 6.3 Provider status

`GET /api/provider-status` doit repondre selon le contrat :

```json
{
  "ok": true,
  "providers": {
    "llm": { "provider": "openclaw", "configured": true, "maskedKey": "***" },
    "tts": { "provider": "elevenlabs", "configured": false, "maskedKey": null },
    "stt": { "provider": "deepgram", "configured": false, "maskedKey": null }
  }
}
```

Le vrai token ne doit jamais apparaitre dans cette reponse.

## 7. Lecture depuis l'installation OpenClaw

Le repo connait actuellement le token OpenClaw parce que l'utilisateur peut le
saisir dans `OnboardingModal` (`BaseProviderConfig.credential`) ou le stocker
dans le repository IndexedDB des credentials. `openclawSetup.ts` ne lit pas
encore le fichier de configuration OpenClaw : il ne fait qu'afficher la
commande et l'instruction `gateway.auth.token` / `OPENCLAW_GATEWAY_TOKEN`.

Il faut donc distinguer deux preuves :

1. **Preuve recommandee** : lire le token deja configure dans Liteforms,
   retourner seulement `configured` et un masque, puis le Mobile le recupere
   via `openclaw-status`.
2. **Preuve explicite demandee** : exposer temporairement le token brut via
   `GET /api/poc/openclaw-token`, uniquement si un flag POC est active. Cette
   route doit etre desactivee par defaut, ne rien logger, ne pas etre incluse
   dans le contrat v1 et etre supprimee avant toute distribution.

Si « token de l'installation locale » signifie le fichier/configuration
OpenClaw lui-meme, ce n'est pas encore branche dans le repo. Il faudra alors un
lecteur cote main process ou un helper controle, avec une source et un chemin
documentes. Une route Next ne doit pas lire arbitrairement le disque et le
Mobile ne doit pas recevoir ce secret par defaut.

### 7.1 Direction produit retenue (12/09/2026, decision post-POC)

Objectif : **supprimer la saisie manuelle du token OpenClaw**. L'app Electron
doit detecter automatiquement l'installation OpenClaw locale (Windows et
Linux), lire le token depuis la configuration de cette installation, et
l'utiliser dans sa propre configuration provider. Le token reste strictement
local a l'appliance : il n'est jamais sert au Mobile ni sur le LAN ; le Mobile
continue de ne recevoir que `configured` + masque via `openclaw-status` /
`provider-status`.

Contraintes retenues pour l'implementation future :

* lecture cote **main process** uniquement (pas de lecture disque depuis une
  route Next), avec chemin(s) documente(s) par OS — ex. fichier de config
  OpenClaw dans le profil utilisateur (`~/.openclaw/` ou equivalent Windows) ;
* helper controle unique (une fonction, une source), echec silencieux propre
  si l'installation OpenClaw est absente : l'utilisateur garde la saisie
  manuelle en fallback ;
* le token lu n'apparait jamais dans les logs, diagnostics, reponses HTTP ou
  erreurs ; la route diagnostique de token brut (§7, preuve 2) reste
  interdite par defaut ;
* decouverte multi-OS : detection du chemin de config par OS puis lecture ;
  cette detection est une tache d'integration post-POC, hors contrat Mobile.

Cette direction remplace la question ouverte « lire le fichier OpenClaw ou
non ? » : oui, c'est le comportement cible de l'architecture finale, avec les
garde-fous ci-dessus.

## 8. Phases d'execution

### Phase A — Joindre Electron depuis le Mobile

- lancer la version packagée avec le serveur accessible sur le LAN ;
- afficher l'IP locale et le port dans le diagnostic local, jamais sur
  l'appliance ;
- verifier `GET /api/health` depuis un telephone ;
- accepter la regle pare-feu Windows sur reseau prive ;
- refuser une origine/une methode HTTP non prevue.

Sortie : le Mobile atteint Electron et recoit une reponse de sante sans WiFi
provisioning.

### Phase B — Config complexe Mobile -> Electron

- envoyer le JSON complet de §4 ;
- valider version, types, champs inconnus et champs secrets ;
- mettre le payload en attente ;
- le renderer le recupere par polling ;
- ecrire `liteforms.poc.deviceConfig` ;
- appliquer character, alcove et providers ;
- retourner `warnings` pour mood/pose/VRM non encore disponibles ;
- verifier l'idempotence en renvoyant deux fois le meme payload.

Sortie : une modification faite dans le Mobile est visible a chaud dans
Electron et reste lisible apres un refresh du renderer.

### Phase C — Electron -> Mobile

- exposer la liste des VRM locaux ;
- exposer les statuts providers masques ;
- exposer l'etat POC non secret ;
- verifier que le Mobile peut selectionner une reference VRM existante ;
- tester une reference inconnue et une liste vide.

Sortie : le Mobile lit des donnees reelles d'Electron, pas seulement un mock.

### Phase D — Token OpenClaw diagnostique

- verifier d'abord la source locale du token (Liteforms IndexedDB/session ou
  installation OpenClaw) ;
- tester `openclaw-status` sans secret ;
- seulement si necessaire, activer explicitement l'endpoint brut POC ;
- verifier absence du token dans logs, erreurs, traces reseau permanentes et
  reponses de toutes les autres routes ;
- desactiver cet endpoint avant toute demo publique ou release.

## 9. Tests d'acceptation

### Reseau

- Mobile et Electron sur le meme WiFi ;
- `GET /api/health` repond depuis le Mobile ;
- l'application fonctionne encore localement sur `127.0.0.1:43178` ;
- le profil pare-feu est prive, pas public ;
- un appareil hors du LAN ne peut pas atteindre le service dans le scenario
  de test.

### Reception et application

- payload valide applique sans redemarrage ;
- `character`, alcove, providers et VRM sont verifies visuellement ou par
  lecture d'etat ;
- `stt -> asr` et `endpoint -> baseUrl` sont verifies ;
- mood/pose non supportes deviennent des warnings explicites ;
- payload invalide refuse avec une erreur stable ;
- champ inconnu ignore ;
- aucun secret accepte dans `device-config` ;
- double envoi idempotent ;
- refresh renderer conserve `liteforms.poc.deviceConfig`.

### Lectures retour

- liste VRM reelle retournee ;
- `modelRef.fileName` existant accepte, inconnu refuse proprement ;
- provider-status masque les valeurs sensibles ;
- OpenClaw status ne retourne pas le token ;
- endpoint brut, si teste, est desactive apres le test et absent du build
  final.

## 10. Hors perimetre

- creation du hotspot `Liteforms-Setup-XXXX` ;
- `POST /api/provisioning/wifi`, NetworkManager, `netsh`, `nmcli`, polkit ;
- mDNS et decouverte automatique ;
- token d'appairage, TLS et durcissement LAN ;
- upload de VRM ;
- preview 3D Mobile ;
- implementation definitive du stockage device dans `userData` ;
- lecture automatique non controlee du disque OpenClaw ;
- retour de credentials provider dans le contrat normal.

## 11. Resultat attendu

Le POC est reussi lorsque le Mobile peut envoyer le payload de §4 a Electron,
qu'Electron le conserve temporairement dans le `localStorage` du renderer,
qu'une partie utile est appliquee a chaud, que les limites sont retournees en
warnings, et que le Mobile peut lire au moins une liste VRM et les statuts
providers reels. La lecture du token OpenClaw brut reste un test diagnostique
optionnel, jamais une regle du contrat v1.

## 12. Etat d'avancement (10/09/2026)

### 12.1 Fait et teste (suite : 693 tests verts, lint 0 erreur, tsc OK)

**Phase A — joindre Electron depuis le LAN (complete)**

- `electron/nextServer.ts` : `LITEFORMS_SERVER_HOST` opt-in (`0.0.0.0` ou `::`
  uniquement) via `resolveServerHost()` ; tout autre valeur retombe sur
  `127.0.0.1`. `HOSTNAME` du serveur Next standalone devient parametrable.
- Renderer et charge toujours `http://127.0.0.1:43178` (origine Chromium
  inchangee -> le fix de persistance du port fixe n'est pas casse) ; lorsque le
  serveur est reutilise (orphan/2e instance), reutilisation sans re-spawn.
- `electron/main.ts` : trace du bind dans le log diagnostique
  (`[next] LAN bind: ...`), + passage de `LITEFORMS_DIAGNOSTIC_LOG` au serveur
  Next pour que les routes ecrivent dans le même journal ; trace `[next]
  server ready on ... (bind host=... port=...)` apres demarrage et `[next]
  server exit code/signal` a la mort du serveur.
- **Traçage POC** (`lib/deviceConfig/pocLog.ts`) : helper ligne `[poc]
  <ISO> <message>` -> console serveur + fichier diagnostique ; jamais le
  payload brut, seulement des metadonnes sûres (codes d'erreur, userAgent
  tronque, noms de champs, providers IDs, compteurs). Trace par route :
  `health GET :: served`, `device-config POST :: accepted receivedAt=...
  warnings=... ua=... character.name... providers=llm:x tts:y stt:z` ou
  `rejected code=...`, `pending-config GET :: consume=... found receivedAt=...`
  ou `empty`.
- `app/api/health/route.ts` : payload contrat v1 complet (`ok`, `name`,
  `protocolVersion`, `configVersions:["1.0"]`, `networkMode:"wifi"`), test
  `route.test.ts`.
- Pas encore teste depuis un vrai telephone (rebuild + pare-feu a faire,
  voir 12.3).

**Phase B — reception de la configuration (serveur, complete)**

- `lib/deviceConfig/pocConfig.ts` : validateur + types `PocDeviceConfig` ;
  rejet `configVersion != "1.0"` (`UNSUPPORTED_CONFIG_VERSION`), pronoms/
  couleur/`modelRef` invalides (`INVALID_FIELD` / `MODEL_REF_UNKNOWN`), et
  **rejet de tout champ secret** (`credential`, `apiKey`, `token`, `password`,
  `secret`, a n'importe quelle profondeur) ; warnings pour `mood`/`pose`
  (ports 6/7/9 non portes) ; champs numeriques non reels de `pose` ignores en
  warning ; champs inconnus ignores.
- `app/api/device-config/route.ts` : `POST` contractuel, idempotent, payload
  parke en memoire module avec `receivedAt` ; reponse `{ok, configVersion,
  appliedAt, warnings}` (la semantics POC d'`appliedAt` = « recu et parque »,
  cf. §5.1).
- `app/api/poc/pending-config/route.ts` : canal de polling renderer, hors
  contrat ; `?consume=1` vide le payload.
- Tests : `app/api/device-config/route.test.ts` (6 tests : payload complet,
  idempotence, version, secret rejete, prounom invalide, consume).

### 12.2 Restant sur la phase B (apply renderer — fait, 12/09/2026)

Implementation :

1. `lib/deviceConfig/pocClient.ts` : polling `GET /api/poc/pending-config`
   (`?consume=1`, ~2 s, tolerance reseau : un seul log par panne, arret propre
   via la fonction retournee) + dedoublonnage par `receivedAt` + ecriture
   `liteforms.poc.deviceConfig` + re-lecture sauvegardee (boot restore).
2. Application des blocs via les chemins existants : `character` ->
   `saveCharacterConfig()` + `setCharacter()` ; `environment.alcoveColor` ->
   nouveau store `lib/storage/environmentConfig.ts` (`saveEnvironmentConfig()`)
   ; `providers` -> mapping `stt->asr`, `endpoint->baseUrl`, `voiceId` ->
   voie du fournisseur (`voiceId` elevenlabs, `voice` ailleurs), realtimeVoice
   local preserve, puis `saveSessionConfig()` + bump `chatPanelKey`
   (meme chemin qu'`app/page.tsx` `handleUseCustom`) ; `avatar.modelRef` ->
   `indexedDbVrmRepository.load()` avec verification `fileName` (warning sinon)
   ; `mood`/`pose` recus mais non appliques.
3. Journalisation renderer au format `[poc] <ISO> <message>` via le chemin
   diagnostique du renderer (`logDiagnostic`, bridge -> meme fichier
   liteforms-diagnostic.log) ; jamais le payload brut, seulement
   receivedAt/blocs/warnings/resume non secret.
4. Test renderer `lib/deviceConfig/pocClient.test.ts` (6 tests : ecriture et
   relecture de la cle, projection des stores, dedoublonnage receivedAt,
   conservation apres refresh + reapply boot, VRM mismatch, provider id
   inconnu).
5. `lib/deviceConfig/pocConfig.ts` doit reste chargeable par le renderer :
   `buildDeviceConfigError` (NextResponse) est deplace dans la route,
   `describeConfigSummary` reste isomorphe. 699 tests verts, lint 0 erreur,
   tsc OK.

### 12.3 Test Phase A sur le terrain (a faire quand on veut)

- rebuild : `npm run build:electron` puis `npm run dist:electron` ;
- lancer une fois avec `LITEFORMS_SERVER_HOST=0.0.0.0` (les reglages Chromium
  restent sur `127.0.0.1` -> aucun risque pour la persistance) ;
- accepter la pop-up pare-feu Windows (reseau privé) ;
- verifier depuis un telephone `http://<IP-LAN-Electron>:43178/api/health` ;
- ensuite envoyer le payload §4 avec `POST /api/device-config`, l'observation
  des warnings dans la reponse, puis (apres 12.2) le apply live.

> Fait le 12/09/2026 (voir §13.1 pour le detail des executions).

## 13. Bilan final du POC (12/09/2026)

### 13.1 Resultats de validation terrain

Toutes les phases ont ete executees avec le package
`release/win-unpacked/Liteforms.exe`, un telephone Android sur le meme WiFi,
et le log diagnostique `%APPDATA%\liteforms-web\liteforms-diagnostic.log` :

* **Phase A** : `GET /api/health` repond depuis le telephone (bind LAN opt-in
  `LITEFORMS_SERVER_HOST=0.0.0.0`, port 43178) ; connexion Mobile affichee
  « Connecté : Liteforms Desktop ».
* **Phase B** : payload complet envoye depuis l'ecran review du Mobile ;
  accuse `{ok, configVersion, appliedAt, warnings}` recu ; application a
  chaud confirmee (nom/personnalite, couleur alcove, providers) ; warnings
  mood/pose remontes comme prevu ; persistance apres refresh renderer OK.
* **Phase C** : `GET /api/poc/vrms` retourne la bibliotheque locale
  (10 fichiers) + builtin ; selection Mobile de plusieurs VRM reels
  (LeafBoy.vrm, Orion.vrm, JokerDude.vrm) ; binaire servi par
  `/api/poc/vrms/file` ; swap a chaud confirme sur le Looking Glass
  (cycle `updateModel` -> `model replace` -> `teardown ending active xr
  session` -> `model framed` -> `auto-enter attempt=1`).
* Aucun secret ni payload brut dans les logs diagnostiques pendant toute la
  campagne.

### 13.2 Incidents rencontres et corrections

1. **Bouton d'envoi Mobile non reactif apres le premier envoi** : `handleSend`
   sans try/finally ; une exception laissait `sending=true` a jamais. Corrige
   (finally + affichage de l'exception).
2. **Crash Mobile `Coordonnees Desktop invalides: host="" port=0`** :
   `registerDesktop` ne mettait pas host/port dans le store Zustand apres un
   health check reussi ; la carte de statut appelait `buildDesktopUrl("", 0)`
   pendant le rendu. Corrige (set host/port + garde d'affichage).
3. **Liste VRM Mobile non scrollable** : contenu dans un `View` statique
   au lieu du `ScrollView` standard des ecrans setup. Corrige.
4. **Ecran noir Looking Glass apres swap de VRM** : la scene 3D etait
   detruite/reconstruite sans terminer la session WebXR active ; le device
   presentait depuis un contexte WebGL dispose. Corrige :
   `renderer.xr.getSession()?.end()` avant teardown + auto-enter avec retry
   borne. **Enseignement majeur** : tout remplacement de modele sur
   l'hologramme doit passer par une terminaison propre de session XR —
   regression a surveiller en architecture finale.
5. **Build Next echoue sur export non-handler** : les fichiers de route Next
   n'acceptent que des handlers HTTP exports ; l'etat pending a ete deplace
   dans `lib/deviceConfig/pendingConfigStore.ts`. Regle a retenir pour toute
   nouvelle route.
6. **Anomalie benigne non corrigee** : `updateModel model-bytes bytes=0` —
   le log lit la taille apres transfert transferable ; la taille reelle est
   loguee par `vrms/file`. Purement cosmetique.

### 13.3 Enseignements transférables a l'architecture finale

1. **Le flux park-and-poll est une base viable** : serveur Next qui parque,
   renderer qui poll — simple, robuste, debuggable via un seul log. Une
   eventuelle pousse IPC main->renderer remplacera le polling, mais la
   frontiere serveur/renderer (le serveur Next n'a PAS acces au
   localStorage du renderer) restera vraie : le canal de transport vers
   l'etat applique devra toujours passer par le renderer.
2. **L'origine Chromium est un invariant** : garder le renderer sur
   `127.0.0.1:43178` et rendre le LAN joignable par bind opt-in a preserve
   toute la persistance existante. Toute integration future qui changerait
   d'origine recreerait un probleme de stockage.
3. **La validation sans confiance a fait ses preuves** : rejet de versions,
   types, secrets a toute profondeur, idempotence, champs inconnus ignores,
   warnings pour le non-supporte. Aucun payload hostile n'a passe. Ce
   validateur (`pocConfig.ts`) est directement reprisable.
4. **La redaction de logs fonctionne** : aucun secret, aucun payload brut,
   chemins jamais complets. Le pattern `[poc] <ISO> <resume>` + bridge
   renderer->fichier diagnostique unique est a generaliser.
5. **La frontiere secret/non-secret tient** : le Mobile pilote tout sauf les
   credentials ; les cles vivent et meurent cote appliance.
6. **Le swap VRM a chaud exige la gestion de session XR** (cf. 13.2.4).
7. **Les stores projetes fonctionnent** : mapper les blocs du contrat vers
   les stores existants (character, environment, session, VRM) est le bon
   pattern d'integration — le payload du contrat ne remplace jamais les
   types internes, il les alimente.

### 13.4 Ce qui est garde dans l'architecture finale

| Element POC | Destination finale |
|---|---|
| Routes contractuelles (`/api/health`, `/api/device-config`, `/api/provider-status`) | Gardees telles quelles, promues contrat v1 stable |
| Validateur `pocConfig.ts` (types, secrets, idempotence, warnings) | Garde, devient la validation de reference |
| Mapping des blocs vers stores existants (pocClient apply) | Garde, remplace le park en memoire par une persistance durable (`userData`) |
| Store `environmentConfig` (alcoveColor + propagation /hologram) | Garde tel quel |
| Bibliotheque VRM locale `<userData>/vrm-library/` + routes metadata/fichier | Garde ; le futur catalogue en ligne alimentera ce meme dossier |
| Teardown XR au swap de modele | Garde comme invariant du chemin hologramme |
| Logging diagnostique redige (pattern [poc]) | Garde, generalise a toutes les routes device |
| Bind LAN opt-in `LITEFORMS_SERVER_HOST` | Garde (par defaut desactive) |
| Park en memoire du payload | **Remplace** par stockage durable dans `userData` (le park etait declare non durable des le plan §3.2) |
| Polling renderer 2 s | Remplaçable par evenement IPC apres validation, a la discretion de l'integration |
| Cle `liteforms.poc.deviceConfig` | Remplacee par le stockage durable ; la cle POC reste lisible comme historique |
| Routes `/api/poc/*` | Retirees de toute distribution ; seules les routes contractuelles et la bibliotheque VRM (requalifiees) restent |
| Route `openclaw-token` brut | Jamais implementee ; reste interdite (cf. §7.1) |

### 13.5 Travail restant hors POC (vers l'architecture finale)

* ~~persistance durable device-config dans `userData` (remplace le park)~~
  **FAIT (12/09/2026)** : `<userData>/config/device-config.json`, écriture
  atomique tmp+rename, relecture au boot par pending-config, migration
  one-shot localStorage → fichier côté renderer, fallback park mémoire en
  dev sans env. Validé terrain (fichier présent et relu après restart).
  Détail : commit « Persist device-config durably in userData ».
* ~~requalification des routes VRM~~ **FAIT (12/09/2026)** : les routes
  bibliotheque VRM ne sont plus POC — `GET /api/device/vrms` et
  `GET /api/device/vrms/file?name=` (meme comportement, nouveau prefixe
  stable ; mise a jour Mobile side a faire par l'orchestrator).
* ~~retrait du canal polling `/api/poc/pending-config`~~ **FAIT (12/09/2026)** :
  remplace par `GET /api/device-config` (lecture durable du meme fichier,
  `{ok, config, receivedAt}` ou `{ok, config:null}`), polling renderer ~2 s
  conserve sur cette route contractuelle, dedoublonnage par `receivedAt`,
  migration one-shot localStorage → fichier rebranchee sur le GET,
  cle localStorage renommee `liteforms.poc.deviceConfig` →
  `liteforms.deviceConfig` (lecture legacy one-shot), park mémoire
  reduit a un fallback dev local a la route. Plus rien sous `/api/poc/`.
* provisioning WiFi (`/api/provisioning/*`) — reste hors perimetre ;
* detection automatique du token OpenClaw local (§7.1) ;
* catalogue VRM en ligne alimentant `vrm-library/` ;
* ports mood/pose (warnings actuels) ;
* remplacement eventuel du polling par IPC.

### 13.6 Architecture de stockage retenue (12/09/2026, decision produit)

Trois mecanismes selon la nature de la donnee, tous dans `<userData>`
(nom de dossier actuel : `liteforms-web`, herite de l'appId historique
`org.liteforms.web` — a renommer avant toute distribution publique si
decide, avec migration copie de dossier) :

| Donnee | Stockage | Chemin |
|---|---|---|
| Config generale (device-config, character, session, environment) | **JSON atomique** (tmp + rename) via serveur Next/main process | `<userData>/config/` |
| RAG / embeddings OpenClaw (gros volumes, requetes) | **SQLite** (better-sqlite3 + sqlite-vec), jamais JSON au-dela de ~10 Mo | `<userData>/` (a venir) |
| Secrets (tokens, cles API, WiFi) | **`safeStorage`** (DPAPI Windows / keyring Linux) + fichier chiffre, fallback saisie manuelle | `<userData>/` (a venir) |

Invariants : le renderer garde ses caches (localStorage/IndexedDB) mais la
source de verite de la config est le fichier ; le main process cree les
dossiers et passe les chemins par variables d'environnement ; aucune
donnee sensible ne quitte l'appliance.
