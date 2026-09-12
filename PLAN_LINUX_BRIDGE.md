# Linux Looking Glass — état en cours (non commité)

> Dernière mise à jour : 09/09/2026.
> **Le diff décrit ici est volontairement NON COMMITÉ** : il vit dans le working tree
> (`git status`) en attendant la validation matérielle sur l'appliance Linux.
> Ne pas merger ni publier avant d'avoir exécuté le cycle « Appliance » ci-dessous.

## 1. Contexte

L'app démarre sur l'appliance Linux (Ubuntu 24.04, X11) mais l'avatar ne s'affiche
jamais sur le Looking Glass. Le diagnostic initial (`liteforms-diagnostic.log` du
09/09) a montré que :

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

## 2. Contenu du diff en attente (12 fichiers)

Tout est diagnostique, sauf deux changements de comportement volontaires.
Vérifié : 684 tests OK, lint 0 erreur, `tsc --noEmit` OK, `npm run build:electron` OK.

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

> **⚠️ BLOQUÉ — À REPRENDRE PLUS TARD** (10/09/2026) : la machine Linux est
> actuellement en panne/unstable, le cycle complet ci-dessous n'a **pas** pu être
> exécuté. Point important sur lequel revenir dès que l'appliance est de retour :
> exécuter les étapes 1→4 dans l'ordre, et tant que ce cycle n'est pas passé,
> **le diff reste volontairement non commité** (cf. §5).

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

## 5. Rappels

- **Ne pas commiter ce diff avant la validation matérielle** (décision utilisateur).
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
