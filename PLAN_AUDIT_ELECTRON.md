# Plan d'audit et de correction Electron

## Objectif

Conserver les adaptations fonctionnelles des commits `Jarvis:` et corriger
leur robustesse sans repartir sur une réécriture du projet.

Les invariants à préserver sont :

- le rendu WebGL, le lip-sync et l'audio dans la fenêtre hologramme ;
- le fonctionnement de l'application principale dans le tray ;
- le fonctionnement sans Looking Glass ;
- le fallback HLD existant ;
- le packaging Windows et le serveur Next standalone.

Le seul changement de comportement produit attendu dans ce plan est la
détection continue du Looking Glass : le PC peut démarrer avant l'écran, puis
l'image doit être envoyée automatiquement dès que l'écran est branché ou sort
de veille et que le Bridge est fonctionnel.

## Stratégie

Ne pas annuler les commits `Jarvis:`. Les conserver comme historique de la
fonctionnalité et appliquer des corrections petites, testables et réversibles.

Avant les corrections :

1. marquer l'état actuel comme baseline de référence ;
2. documenter les scénarios matériels testés ;
3. corriger d'abord la détection Bridge et le handshake hologramme ;
4. ne modifier le rendu ou le protocole que lorsque le test ciblé l'exige.

## Phase 1 - Etat Bridge et écran

### 1.1 Source d'autorité

Centraliser l'état dans un contrat explicite, par exemple :

```text
unavailable
checking
connected
disconnected
error
```

Un état `connected` doit signifier à la fois :

- un Bridge utilisable ;
- un écran Looking Glass réellement détecté ;
- une calibration exploitable ;
- des bounds d'écran connus pour positionner la fenêtre.

Un simple écran secondaire ou portrait ne doit plus suffire.

### 1.2 Vérification périodique

Ajouter un check périodique unique, partagé avec le statut affiché par
l'application et la logique d'auto-ouverture.

- intervalle configurable, valeur initiale à définir après mesure ;
- recommandation de départ : `1000` à `2000 ms` ;
- ne pas lancer un nouveau check si le précédent est encore en cours ;
- mémoriser le dernier état pour ne réagir qu'aux transitions ;
- arrêter le timer au quit et lors de la destruction du service.

Le polling reste nécessaire car le Bridge peut apparaître après le démarrage,
et un écran peut revenir après une veille sans provoquer exactement le même
signal système qu'un branchement.

### 1.3 Evénements système complémentaires

Utiliser aussi les événements Electron disponibles :

- `display-added` ;
- `display-removed` ;
- `display-metrics-changed`.

Ces événements accélèrent la réaction, mais ne remplacent pas le polling.
Tous les chemins doivent appeler la même fonction de reconciliation pour éviter
de dupliquer la logique.

### 1.4 Bridge natif et Bridge.js

Le check doit essayer les capacités dans cet ordre :

1. Bridge natif Electron si disponible ;
2. Bridge.js/WebSocket si le natif est indisponible ;
3. état non connecté si aucun chemin ne confirme l'écran.

L'existence de l'API preload native ne doit pas empêcher le fallback Bridge.js.
Les erreurs de chargement du driver, l'absence de calibration et l'absence de
display doivent être distinguées.

### 1.5 Transition vers l'hologramme

Lors d'une transition vers `connected` :

- positionner la fenêtre sur les bounds du Looking Glass ;
- créer la fenêtre `/hologram` si elle n'existe pas ;
- réutiliser la fenêtre si elle existe déjà ;
- attendre son handshake `ready` avant d'envoyer modèle et audio ;
- déclencher la session Looking Glass une seule fois ;
- reprendre le rendu automatiquement après un réveil.

Lors d'une transition vers `disconnected` ou `checking` :

- ne pas créer une nouvelle fenêtre ;
- ne pas lancer de boucle d'ouvertures ;
- conserver un état récupérable sans faire crasher l'application ;
- définir séparément le comportement de fermeture ou de parking de la fenêtre
  existante, sans l'introduire implicitement dans cette phase.

Ajouter un verrou de transition et un identifiant de fenêtre pour éviter les
ouvertures concurrentes lorsque le polling et les événements système arrivent
ensemble.

## Phase 2 - Handshake et transport hologramme

Corriger le protocole entre la fenêtre principale et `/hologram`.

- écouter et consommer le message `ready` ;
- mettre en file le modèle, les frames lip-sync et les buffers audio avant
  `ready` ;
- rejouer les messages dans l'ordre après `ready` ;
- gérer explicitement une fenêtre fermée ou recréée ;
- propager un changement de modèle vers une fenêtre déjà ouverte ;
- révoquer les anciennes URLs `blob:` ;
- arrêter la boucle RAF audio lorsque la lecture est terminée.

Le callback TTS ne doit retourner `true` que lorsque le message peut réellement
être accepté par la fenêtre hologramme. Sinon, la fenêtre principale garde le
fallback audio actuel.

## Phase 3 - Sécurité et validation des messages

Remplacer le protocole applicatif permissif par un protocole contrôlé :

- utiliser l'origine exacte de l'application au lieu de `"*"` ;
- vérifier `event.origin` ;
- vérifier `event.source === window.opener` côté hologramme ;
- valider `kind`, les champs numériques et les buffers avant traitement ;
- limiter la taille des modèles et des buffers audio ;
- ne jamais accepter une commande de session provenant d'une autre fenêtre.

Conserver l'IPC preload minimal et compléter ses types, notamment pour
`diagnostic.log`.

## Phase 4 - Cycle de vie, tray et diagnostics

- supprimer le double branchement des diagnostics sur la fenêtre principale ;
- annuler tous les timers au quit et à la fermeture de fenêtre ;
- arrêter proprement `powerSaveBlocker` ;
- vérifier le cycle minimisation, restauration, fermeture et recréation ;
- éviter les logs diagnostics non bornés et redacter toute donnée sensible ;
- conserver le comportement tray sans modifier la logique de rendu déjà
  validée.

Les switches Chromium globaux et le `powerSaveBlocker` doivent être conservés
uniquement s'ils sont nécessaires après mesure du rendu tray/hologramme. Ne pas
les supprimer avant d'avoir un test matériel équivalent.

## Phase 5 - Packaging et tests

Corriger les tests obsolètes dans `electron/electronBuild.test.ts` :

- chemin `resources/next/standalone` ;
- configuration Linux actuelle ;
- copie effective de `server.js` après `afterPack`.

Faire échouer `afterPack` si le serveur standalone est absent au lieu de
produire silencieusement un installateur incomplet.

Ajouter des tests ciblés pour :

- Bridge natif connecté ;
- Bridge natif indisponible avec Bridge.js fonctionnel ;
- PC démarré sans Looking Glass ;
- branchement du Looking Glass après démarrage ;
- sortie de veille ;
- écran secondaire non Looking Glass ;
- polling et événement écran simultanés ;
- fenêtre hologramme lente à charger ;
- audio et modèle envoyés avant `ready` ;
- fermeture puis réouverture de la fenêtre hologramme ;
- restauration depuis le tray.

## Critères d'acceptation matériel

Le comportement ne sera considéré comme terminé qu'après ces scénarios :

1. démarrer le PC sans Looking Glass : aucune fenêtre hologramme parasite ;
2. brancher le Looking Glass après le démarrage : l'image apparaît
   automatiquement sur le bon écran ;
3. réveiller le Looking Glass après une veille : le rendu reprend sans second
   clic ;
4. brancher un écran portrait ordinaire : aucune auto-ouverture hologramme ;
5. retirer le Looking Glass : l'application principale reste utilisable et ne
   multiplie pas les fenêtres ou les timers ;
6. minimiser dans le tray pendant une réponse audio : rendu et lip-sync restent
   synchronisés ;
7. lancer le build packagé : le serveur Next et les ressources Bridge sont
   présents aux chemins attendus.

## Ordre des commits correctifs

1. `Define Bridge/display reconciliation and polling`
2. `Restore Bridge.js fallback in Electron`
3. `Queue hologram messages until ready`
4. `Validate hologram postMessage contract`
5. `Clean up hologram and Electron lifecycle`
6. `Harden Electron packaging checks`
7. `Add Looking Glass reconnect regression tests`

Chaque commit doit rester indépendant autant que possible et être vérifié avec
les tests ciblés avant les tests complets.
