# Linux Looking Glass — état en cours

> Dernière mise à jour : 17/09/2026 (soir).
> **✅ OBJECTIF ATTEINT** : le terrain du 17/09 confirme que **le LKG affiche
> l'hologramme**. Le diff décrit ci-dessous (12 fichiers, §2) plus le correctif du
> probe natif du 16/09 (§5) ont été **commités ensemble** dans le commit
> `Jarvis: fix native Bridge probe on Linux and validate LKG hologram` après
> validation terrain (voir §7 pour les preuves de log). Phase Linux Looking Glass
> **close** côté affichage ; reste listé en §7.4.

## 1. Contexte

L'app démarre sur l'appliance Linux (Ubuntu 24.04, X11) mais l'avatar ne s'affiche
jamais sur le Looking Glass (**résolu le 17/09 — voir §7**). Le diagnostic initial
(`liteforms-diagnostic.log` du 09/09) a montré que :

- le **probe natif** (`libbridge_inproc.so`) échoue **silencieusement** — le
  renderer avalait l'erreur, rien n'était logué ;
- le fallback **Bridge.js** ne peut pas fonctionner : pas de daemon Looking Glass
  Bridge (LGB) sous Linux, et `holoplay-core` (utilisé par le polyfill webxr pour
  `syncCalibration`) parle au protocole HoloPlay historique (`ws://localhost:11222`),
  que LGB moderne ne sert pas ;
- le polyfill `@lookingglass/webxr` rend le quilt **100 % côté client** : seule la
  **calibration** dépend d'un service. Donc sous Linux, l'affichage dépend
  entièrement du probe natif.

Faits vérifiés localement (machine Windows) :

- le mécanisme packagé fonctionne : probe lancé depuis `app.asar` avec
  `ELECTRON_RUN_AS_NODE=1`, koffi résolu depuis `app.asar.unpacked` ;
- `bridge_inproc.dll` **tue silencieusement son hôte** (exit 0, aucun output) quand
  il ne peut pas s'initialiser (aucun appareil LG sur la machine de test) — les
  autres DLL du même dossier se chargent normalement ;
- audit ELF de `libbridge_inproc.so` : il lie des libs système **non bundle**
  (GTK3, `libdbusmenu-glib.so.4`, ALSA, X11/GL, libusb via hidapi-libusb) ;
- le probe child n'héritait pas de `DISPLAY`/`XAUTHORITY` (filtre d'env), alors
  que la lib lie GTK3/SDL/X11 → blocage Linux probable au `initialize_bridge`.

## 2. Diff de diagnostic (commité en `5ea878f`, validé terrain 17/09)

Tout est diagnostique, sauf deux changements de comportement volontaires.
Vérifié à l'époque : 684 tests OK, lint 0 erreur, `tsc --noEmit` OK,
`npm run build:electron` OK (848 tests verts au moment de la validation terrain).

| Fichier | Changement | Type |
|---|---|---|
| `electron/nextServer.ts` | Transfert de `DISPLAY`, `XAUTHORITY`, `WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, `XDG_SESSION_TYPE`, `DBUS_SESSION_BUS_ADDRESS` vers les child processes (allowlist existante) | **correctif Linux** |
| `electron/nativeBridge.ts` | Log de chaque probe (start/timeout/error/résultat) dédupliqué par état ; erreur « no data » enrichie avec le stderr réel de la lib (nom du `.so` manquant, etc.) + checklist USB/udev | diagnostique |
| `electron/main.ts` | Inventaire `[displays]` au whenReady + sur `display-added/removed/metrics-changed` ; placement hologramme : match exact → `findLookingGlassDisplay()` (portrait/largest secondary) → nearest (l'ancien code faisait nearest d'abord) | diagnostique + durcissement placement (renforce « ne pas remplir l'écran primaire ») |
| `lib/avatar/bridgeConnection.ts` | Champ typé `error?` sur `LookingGlassBridgeConnection` : la raison d'échec natif remonte sans changer les chemins de succès | diagnostique |
| `app/page.tsx` | Log de transition du poll (`bridge poll connected/disconnected source=… error=…`) ; un ref `previousConnectionKeyRef` | diagnostique |
| `components/avatar/AvatarScene.tsx` | Log `native calibration applied serial=… WxH` et `native calibration unavailable: <erreur>` | diagnostique |
| `lib/avatar/nativeLookingGlassBridge.ts` | **Seul changement sémantique** : `isNativeLookingGlassBridgeDisplayConnected` accepte serial **ou** dimensions valides (le probe ne renvoie `available:true` que si l'appareil est réellement trouvé) | à revoir/revalider sur matériel |
| `native/bridge/README.md` | Section « Linux runtime requirements » : `ldd`, paquets système, câble USB obligatoire, règle udev, lancement manuel du probe | doc |
| Tests (`nativeBridge.test.ts` +3, `electronBuild.test.ts` +1, `bridgeConnection.test.ts` +1, `nativeLookingGlassBridge.test.ts` +1) | Couverture des comportements ci-dessus | tests |

Décisions antérieures **annulées** (motivées par un faux contexte) et revenue à
l'état de la base propre : chemin auto-open « second écran », garde « jamais HLD »
dans la fenêtre hologramme, calibration de repli improvisée, bouton « Voir en holo »
re-désactivé (état d'origine restauré).

## 3. Cycle « Appliance » à exécuter (dans cet ordre)

> **✔️ EXÉCUTÉ le 17/09/2026** — le cycle a été mené à son terme sur l'appliance
> (AppImage reconstruite) et l'hologramme s'affiche. Les étapes 1→4 ci-dessous sont
> conservées comme procédure de re-test : le diff de diagnostic a été commité
> (`5ea878f`), la cause racine du probe natif identifiée le 16/09 (§5) puis
> corrigée et validée terrain (§7).

1. **Sans rebuild** — vérifier les libs manquantes sur l'appliance :

   ```bash
   ldd /tmp/.mount_*/resources/bridge/linux-x64/libbridge_inproc.so | grep "not found"
   ```

   Si sortie non vide → installer les paquets correspondants (mapping dans
   `native/bridge/README.md`), puis re-tester (sortie vide attendue).

2. **Sans rebuild** — USB : le câble USB PC → Looking Glass doit être branché
   (HDMI seul = image OK mais calibration impossible). Vérifier avec `lsusb`
   (noter `idVendor:idProduct`) ; si besoin poser la règle udev :

   ```bash
   sudo tee /etc/udev/rules.d/99-looking-glass.rules > /dev/null <<'EOF'
   SUBSYSTEM=="usb", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="XXXX", MODE="0660", TAG+="uaccess"
   SUBSYSTEM=="hidraw", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="XXXX", MODE="0660", TAG+="uaccess"
   EOF
   sudo udevadm control --reload-rules && sudo udevadm trigger
   # puis débrancher/rebrancher l'USB
   ```

3. **Un seul rebuild Linux** avec le diff courant (`npm run dist:electron` sous
   Linux — AppImage), puis lancer l'app.

4. **Extraire du log** (`~/.config/liteforms-web/liteforms-diagnostic.log`) et
   interpréter :

   | Ligne attendue | Si absente / en échec |
   |---|---|
   | `[displays] …` | Electron ne voit pas le LG → câble/DRM/X11 |
   | `nativeBridge probe :: available=true …` | probe OK → l'auto-open doit déclencher le hologramme avec la vraie calibration |
   | `nativeBridge probe failed :: <raison>` | la raison exacte (lib manquante / udev / appareil injoignable) → corriger puis re-tester SANS rebuild |
   | `bridge poll disconnected … error="…"` | Renderer : même info côté poll |
   | `native calibration applied …` | Calibration réellement appliquée au polyfill |

## 4. Si le probe passe (available=true) et que ça ne s'affiche toujours pas

À ce stade seulement (et pas avant) : investiguer le rendu (fenêtre hologramme
sur le bon display — vérifiable via `[windowOpen →] override=yes` + `did-navigate
display="…"`, DOM via `holo-dom :: …`). Ne pas toucher au chemin d'affichage tant
que le probe n'est pas vert : le code actuel est conçu pour ça.

## 5. Terrain 16/09/2026 — probe natif Linux : cause racine et correctif

Run terrain Ubuntu 22.04 (AppImage). Le LKG (`LKG-E13328`) est bien énuméré par
Electron (`[displays] … 720x1280`), mais le probe natif échoue :

```
nativeBridge probe :: available=false error="Failed to load shared library:
undefined symbol: app_indicator_set_icon_theme_path"
```

- **Cause racine** : `libbridge_inproc.so` importe `app_indicator_new`,
  `app_indicator_set_icon`, `app_indicator_set_icon_theme_path`,
  `app_indicator_set_menu`, `app_indicator_set_status` **sans `DT_NEEDED`**
  appindicator (vérifié dans le binaire : seuls les noms de symboles et le chemin
  d'include `/usr/include/libayatana-appindicator3-0.1/…` apparaissent). koffi
  charge avec `RTLD_NOW | RTLD_LOCAL` → échec immédiat sur symbole non résolu.
- **Piste écartée** : mbedTLS (`libmbedcrypto.so.1`, `libmbedx509.so.0`,
  `libmbedtls.so.10`) est **bundle** dans `native/bridge/linux-x64/` — pas une
  cause.
- **Correctif** (`electron/nativeBridgeProbe.ts`, Linux uniquement) : avant
  `koffi.load(libraryPath)`, précharger la chaîne mbedTLS présente dans le runtime
  puis les candidats appindicator (`libappindicator3.so.1`, `libappindicator3.so`,
  `libappindicator.so.1`, `libappindicator.so`,
  `libayatana-appindicator3.so.1`, `libayatana-appindicator3.so`) avec
  `{ global: true }`, premier candidat chargeable gagnant. Même contournement que
  le SDK Python upstream (`BridgeApi.py`, « Linux: preload hard dependencies »).
  Si aucun candidat ne charge, l'erreur « undefined symbol » d'origine reste
  remontée (pas d'échec silencieux).
- **Dépendance runtime** : paquet système `libayatana-appindicator3-1`
  (Ubuntu 22.04/24.04), non bundle-able (licence upstream) ; doc dans
  `native/bridge/README.md`.
- **Validation** : plan de préchargement couvert par des tests unitaires (Windows
  CI → plan vide). **Validé terrain le 17/09/2026** sur Ubuntu 24.04 X11 : le
  `dlopen` réel passe, le probe renvoie
  `available=true display="Looking Glass Go" serial="LKG-E13328" 1440x2560
  pos=3840,0 quilt=11x6` (voir §7). L'erreur `undefined symbol` a disparu.

Suite du terrain : un dlopen à froid du `libbridge_inproc.so` (96 Mo, AppImage
`compression: "maximum"`) prend 4-7 s sur le mini-PC ; le timeout de 7 s était
atteint à la limite et produisait des faux négatifs, pendant que des probes
s'empilaient. Correctifs :

- `probeTimeoutMs` 7000 → **30000** (`electron/nativeBridge.ts`).
- Single-flight du probe (`createSingleFlight`) : des `getState()` concurrents
  attendent la même promesse au lieu de lancer plusieurs enfants de 96 Mo.
- À l'expiration : SIGTERM puis SIGKILL après 2 s si l'enfant n'est pas sorti
  (un process bloqué dans `dlopen` n'obéit pas toujours à SIGTERM) ; même chemin
  dans `dispose()`.

## 6. Rappels

- Le seul changement sémantique à re-soumettre en revue : le relax
  « serial OU dimensions » dans `isNativeLookingGlassBridgeDisplayConnected`.
- Le test Windows packagé peut être reproduit à tout moment :

  ```powershell
  # probe depuis un asar de test + ELECTRON_RUN_AS_NODE=1 (voir session 09/09)
  ```

- Le POC Expo/Android (`expo-gl`, silhouette noire) est un sujet **séparé** :
  `expo-gl` n'implémente pas `gl.pixelStorei` (limite connue, matériaux
  MToon/VRM cassés). Ne pas chercher à « réparer » via le code Electron ;
  voie alternative mobile : WebView (WebGL Chromium complet). Le plan Directeur
  avait déjà flag ce risque (« tester vite MToon/WebGL2 ; sinon snapshot live »).

## 7. Terrain 17/09/2026 — objectif atteint (le LKG affiche l'hologramme)

Cycle §3 exécuté par le propriétaire du mini-PC sur AppImage reconstruite.
**L'hologramme s'affiche** : le diff du §2 + le correctif §5 ont été commités
après cette validation (un seul commit, cf. `git log`).

### 7.1 Checklist — résultats

| Étape | Attendu | Résultat |
|---|---|---|
| `echo $XDG_SESSION_TYPE` | `x11` | **`x11`** ✓ (Wayland hors sujet) |
| `dpkg -l \| grep -iE 'appindicator\|ayatana'` | `libayatana-appindicator3-1` installé | **`libayatana-appindicator3-1 0.5.93-1build3`** ✓ (+ `-dev`, `gir1.2-…`, extension GNOME) |
| `lsusb` | LKG visible | **absent de `lsusb`** — **sans effet** : la détection passe par le SDK natif (HID/DRM), aucune règle udev n'a été nécessaire |
| probe natif (log) | `available=true` | **`nativeBridge probe :: available=true display="Looking Glass Go" serial="LKG-E13328" 1440x2560 pos=3840,0 quilt=11x6`** ✓ |
| calibration | `native calibration applied` | **`native calibration applied serial=LKG-E13328 1440x2560`** ✓ |
| fenêtre holo | `/hologram` sur le LKG, canvas natif | **`VRButton click … pathname=/hologram container=720x1280 canvas=1440x2560`** + `AvatarScene model framed hologram=true scale=0.895` ✓ |

Détail utile pour la suite : le probe renvoie des **pixels physiques**
(`1440x2560 pos=3840,0`) là où Electron énumère le LKG en **logique**
(`[displays] … 720x1280 pos=1920,0`, `dpr=2`). Cohérent (×2), la calibration est
appliquée en 1440x2560 — ne pas « corriger » cet écart.

**Rappel cause racine** : `hologramAutoOpen.ts:25` exige des **bounds d'écran** ;
seul le probe natif en fournit (`bridge-js` renvoie `connected` avec `display=-`).
Probe cassé (`undefined symbol: app_indicator_set_icon_theme_path`, §5) ⇒ décision
`"none"` ⇒ jamais de fenêtre `/hologram`, alors que le LKG était bien énuméré.
Le préchargement `RTLD_GLOBAL` appindicator + mbedTLS a débloqué toute la chaîne.

### 7.2 Procédure de re-test (sans rebuild) — conservée pour la suite

Depuis un terminal de la session graphique (DISPLAY requis), AppImage extraite :

```bash
./liteforms-0.0.1.AppImage --appimage-extract > /dev/null
cd squashfs-root
LD_LIBRARY_PATH="$PWD/resources/bridge/linux-x64" \
ELECTRON_RUN_AS_NODE=1 \
LITEFORMS_NATIVE_BRIDGE_LIBRARY="$PWD/resources/bridge/linux-x64/libbridge_inproc.so" \
LITEFORMS_NATIVE_BRIDGE_RUNTIME_DIR="$PWD/resources/bridge/linux-x64" \
./liteforms-web resources/app.asar/dist-electron/nativeBridgeProbe.js
```

Arbre de lecture : `{"available":true,…}` → OK ; `"No Looking Glass displays were
reported"` → USB/DRM, pas appindicator ; `undefined symbol: app_indicator_…` →
paquet/préchargement (vérifier `dpkg -l`) ; `libmbedtls.so.10` introuvable →
`LD_LIBRARY_PATH` non pris. ⚠️ `LD_LIBRARY_PATH` reste obligatoire en manuel (la
résolution du RUNPATH n'est pas transitive ; l'app le règle elle-même dans
`createNativeBridgeProbeEnv`).

### 7.3 Bruit de log restant après succès (non bloquant, non régressif)

Présent sur le chemin polyfill WebXR, constatable aussi hors Linux :
`Unable to find VRButton`, `optional feature 'bounded-floor'/'layers' is not
supported`, `THREE.WebGLRenderer: Can't change size while VR device is
presenting`, `WebGL: INVALID_VALUE: uniform1fv: no array`, `attempted to assign
baselayer twice?`, `THREE.Clock/PCFSoftShadowMap deprecated`. Aucun n'empêche
l'affichage. **Ne pas partir en chasse** sans symptôme visible côté LKG.

### 7.4 Points ouverts / limites assumées

- Le daemon **Looking Glass Bridge n'est pas nécessaire** à notre chemin : le
  polyfill rend le quilt côté client et le probe natif fournit la calibration.
  La bascule « probe natif → websocket JS » prévue au plan Directeur est
  **abandonnée** pour l'appliance : le probe natif fonctionne.
- Limite connue : si un probe expire **et** que l'app quitte dans les 2 s, le
  SIGKILL différé (`unref`) peut ne pas partir → process orphelin possible.
  Vérifier avec `ps` si suspicion ; correctif volatil seulement si observé.
- Le poll renderer reste à 1500 ms (`app/page.tsx:26`) avec un cache de 2500 ms →
  un probe toutes les ~3 s même quand tout marche ; si l'appliance est chargée à
  tort, discuter d'espacer le poll (décision produit, non tranchée).
- **Règle commit (respectée)** : un seul commit pour le feature complet validé
  terrain, jamais de fix-commit intermédiaire.
