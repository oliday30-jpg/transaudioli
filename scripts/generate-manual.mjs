// Génère le manuel utilisateur PDF de TransAudiOli. Le contenu HTML est
// inline (pas de fichier séparé) pour que le manuel reste un seul script
// autonome et facile à relancer après un ajout de fonctionnalité : voir le
// script "manual" dans package.json.
//
// Doit tourner comme process Electron (a besoin de BrowserWindow.printToPDF),
// pas comme script Node classique — lancé via scripts/run-manual.mjs.

import { app, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = join(__dirname, '..', 'docs', 'Manuel-Utilisateur-TransAudiOli.pdf')
const today = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Manuel TransAudiOli</title>
<style>
  :root {
    --ink: #1d2420;
    --muted: #6b756e;
    --accent: #c4602a;
    --accent-soft: #f6e6da;
    --line: #e3e8e1;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', sans-serif;
    color: var(--ink);
    font-size: 12px;
    line-height: 1.55;
    margin: 0;
    padding: 0 4px;
  }
  .cover {
    padding-top: 90px;
    text-align: center;
  }
  .cover .mic {
    font-size: 46px;
  }
  .cover h1 {
    color: var(--accent);
    font-size: 30px;
    margin: 10px 0 2px;
  }
  .cover .subtitle {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 40px;
  }
  .cover .meta {
    color: var(--muted);
    font-size: 11px;
  }
  .cover .toc {
    text-align: left;
    max-width: 380px;
    margin: 50px auto 0;
    background: var(--accent-soft);
    border-radius: 10px;
    padding: 18px 24px;
  }
  .cover .toc h2 {
    font-size: 12px;
    color: var(--accent);
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .cover .toc ol {
    margin: 0;
    padding-left: 18px;
    font-size: 11.5px;
  }
  .cover .toc li {
    margin: 3px 0;
  }

  /* Le contenu s'enchaîne librement d'une page à l'autre (pas de saut de
     page systématique par section) pour ne pas gâcher de place — seule la
     toute première section démarre après la couverture. */
  section:first-of-type {
    break-before: page;
  }
  h1.section-title {
    color: var(--accent);
    font-size: 16px;
    border-bottom: 2px solid var(--accent-soft);
    padding-bottom: 5px;
    margin: 22px 0 10px;
    break-after: avoid;
  }
  table, .hint {
    break-inside: avoid;
  }
  h2 {
    font-size: 13px;
    color: var(--ink);
    margin: 12px 0 4px;
    break-after: avoid;
  }
  h2 .icon {
    margin-right: 4px;
  }
  h3 {
    font-size: 12.5px;
    color: var(--accent);
    margin: 10px 0 3px;
    break-after: avoid;
  }
  p { margin: 3px 0; }
  ul, ol { margin: 3px 0; padding-left: 20px; }
  li { margin: 1px 0; }
  .hint {
    background: var(--accent-soft);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 11.5px;
    margin: 6px 0;
  }
  .hint b { color: var(--accent); }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 11px;
    margin: 8px 0;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .kbd {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 10.5px;
    background: var(--accent-soft);
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 5px;
    white-space: nowrap;
  }
  .muted { color: var(--muted); }
  .badge {
    display: inline-block;
    font-size: 10px;
    background: var(--accent);
    color: white;
    border-radius: 5px;
    padding: 1px 7px;
    margin-left: 6px;
  }
</style></head>
<body>

<div class="cover">
  <div class="mic">🎙️</div>
  <h1>TransAudiOli</h1>
  <p class="subtitle">Manuel d'utilisation</p>
  <p class="meta">Version personnelle — document généré le ${today}</p>

  <div class="toc">
    <h2>Sommaire</h2>
    <ol>
      <li>Introduction</li>
      <li>Premiers pas</li>
      <li>Dicter : les trois modes</li>
      <li>Commandes vocales</li>
      <li>Arrêt automatique par silence</li>
      <li>Fournisseurs de transcription</li>
      <li>Vocabulaire technique</li>
      <li>Microphone &amp; niveau audio</li>
      <li>Notifications</li>
      <li>Historique des dictées</li>
      <li>Usage &amp; coûts</li>
      <li>Clés API &amp; sécurité</li>
      <li>Verrouillage rapide</li>
      <li>Réglages généraux</li>
      <li>Module Réunion</li>
      <li>Mises à jour automatiques</li>
      <li>Astuces</li>
      <li>Dépannage rapide</li>
    </ol>
  </div>
</div>

<section>
  <h1 class="section-title">1. Introduction</h1>
  <p>TransAudiOli est une application de dictée vocale et de prise de notes de réunion, développée
  pour un usage personnel afin de dicter du texte n'importe où sur l'ordinateur (éditeur de code, email,
  documents…) sans dépendre d'un outil partagé, et pour transcrire et résumer automatiquement des
  réunions (appels Zoom/Teams ou discussions en présentiel).</p>
  <p>Deux grandes familles de fonctions :</p>
  <ul>
    <li><b>Dictée</b> : un raccourci clavier déclenche l'enregistrement, la voix est transcrite puis
      collée automatiquement là où se trouve le curseur.</li>
    <li><b>Réunion</b> : capture simultanée du micro et de l'audio système, transcription avec
      identification des intervenants, résumé structuré (décisions, actions à faire) et sauvegarde
      consultable dans l'application.</li>
  </ul>
  <p>La transcription passe par plusieurs fournisseurs cloud (Groq, Deepgram, Whisper/OpenAI) avec
  bascule automatique en cas d'échec de l'un d'eux.</p>
</section>

<section>
  <h1 class="section-title">2. Premiers pas</h1>
  <h2>Fenêtre principale</h2>
  <p>La fenêtre est volontairement compacte et sans bordure système. Les boutons <b>—</b> et <b>✕</b>
  en haut à droite réduisent ou ferment la fenêtre ; fermer la ramène dans la zone de notification
  (system tray) plutôt que de quitter l'application.</p>
  <h2>Icône dans la zone de notification</h2>
  <p>Un clic sur l'icône réaffiche la fenêtre. C'est depuis cette icône que l'application continue de
  fonctionner en arrière-plan, prête à répondre aux raccourcis clavier même fenêtre fermée.</p>
  <h2>Démarrage automatique</h2>
  <p>Dans <b>Réglages</b>, un interrupteur permet de lancer TransAudiOli automatiquement à l'ouverture
  de session Windows (fenêtre réduite, directement dans la zone de notification).</p>
</section>

<section>
  <h1 class="section-title">3. Dicter : les trois modes</h1>
  <p>Trois raccourcis, disponibles n'importe où (pas besoin que la fenêtre soit au premier plan) :</p>
  <table>
    <tr><th>Mode</th><th>Raccourci par défaut</th><th>Effet</th></tr>
    <tr><td><b>Brut</b></td><td class="kbd">Ctrl+R</td><td>Transcription telle quelle, sans retouche.</td></tr>
    <tr><td><b>Nettoyé</b></td><td class="kbd">Ctrl+Alt+D</td><td>Corrige hésitations, ponctuation, tournures orales — le fond ne change pas.</td></tr>
    <tr><td><b>Réécrit</b></td><td class="kbd">Ctrl+Alt+E</td><td>Reformule et structure ; comprend aussi les commandes vocales (section 4).</td></tr>
    <tr><td><b>Annuler</b></td><td class="kbd">Ctrl+Shift+R</td><td>Interrompt l'enregistrement en cours sans rien transcrire.</td></tr>
  </table>
  <p>Fonctionnement : un premier appui démarre l'enregistrement (un discret indicateur apparaît), un
  second appui du même raccourci l'arrête et lance la transcription — le résultat est copié dans le
  presse-papiers et collé automatiquement à l'endroit où se trouve le curseur.</p>
  <div class="hint">Les raccourcis sont modifiables dans <b>Réglages</b> si l'un d'eux entre en conflit
  avec un autre logiciel installé sur le poste.</div>
</section>

<section>
  <h1 class="section-title">4. Commandes vocales</h1>
  <p>En mode <b>Réécrit</b>, commencer sa phrase par l'une de ces expressions déclenche un gabarit de
  réécriture adapté :</p>
  <table>
    <tr><th>Expression de départ</th><th>Effet</th></tr>
    <tr><td>« corrige le bug »</td><td>Reformule comme la description d'un correctif : symptôme, cause, correction.</td></tr>
    <tr><td>« explique »</td><td>Reformule comme une explication claire et structurée.</td></tr>
    <tr><td>« refactorise »</td><td>Reformule comme la description d'un refactoring : objectif, changements.</td></tr>
    <tr><td>« nouvelle fonctionnalité »</td><td>Reformule comme la description d'une nouvelle fonctionnalité à implémenter.</td></tr>
  </table>
  <p>Le déclencheur est retiré du texte final ; seul le contenu reformulé selon le gabarit correspondant
  est collé.</p>
</section>

<section>
  <h1 class="section-title">5. Arrêt automatique par silence</h1>
  <p>Par défaut, l'enregistrement s'arrête tout seul après une courte pause silencieuse — pas besoin de
  rappuyer sur le raccourci. La durée de silence tolérée avant arrêt automatique se règle dans
  <b>Réglages</b> (en secondes) : l'augmenter évite un arrêt prématuré pendant une pause de réflexion,
  la diminuer accélère le résultat pour des phrases courtes.</p>
</section>

<section>
  <h1 class="section-title">6. Fournisseurs de transcription</h1>
  <p>Trois fournisseurs sont configurés, essayés dans un ordre de priorité modifiable depuis
  <b>Réglages</b> : si le premier échoue (clé manquante, panne, quota dépassé), le suivant prend
  automatiquement le relais.</p>
  <table>
    <tr><th>Fournisseur</th><th>Rôle</th></tr>
    <tr><td>Groq</td><td>Transcription rapide, fournisseur principal par défaut.</td></tr>
    <tr><td>Deepgram</td><td>Fournisseur de repli ; seul fournisseur utilisé pour la diarisation en mode Réunion.</td></tr>
    <tr><td>Whisper (OpenAI)</td><td>Second fournisseur de repli.</td></tr>
  </table>
  <p>Le fournisseur réellement utilisé pour chaque dictée est indiqué dans l'historique.</p>
</section>

<section>
  <h1 class="section-title">7. Vocabulaire technique</h1>
  <p>Des termes techniques (noms d'outils, d'instruments, jargon métier) peuvent être fournis pour
  améliorer la reconnaissance de mots inhabituels — modifiables librement dans <b>Réglages</b>.</p>
  <h2>Plusieurs listes indépendantes</h2>
  <p>Le vocabulaire se répartit en <b>listes nommées séparées</b> (par exemple « VS Code » pour le
  développement, « ThermoFisher » pour les instruments de laboratoire) plutôt qu'un seul bloc de texte —
  chaque liste a son propre nom, son propre contenu, et une case à cocher pour l'activer ou la
  désactiver individuellement. Toutes les listes cochées contribuent ensemble à la reconnaissance.</p>
  <p>Pour créer une nouvelle liste : dans Réglages → Vocabulaire technique → <b>+ Nouvelle liste</b>,
  puis renommer la carte et y coller les termes (séparés par des virgules). Chaque champ s'enregistre
  automatiquement dès qu'on en sort (pas de bouton "Enregistrer" à chercher). La case à cocher permet de
  désactiver temporairement une liste sans la supprimer ; le ✕ la supprime définitivement.</p>
  <h2>Vocabulaire de projet (automatique)</h2>
  <p>En sélectionnant un dossier de projet VS Code, l'application lit son <code>package.json</code> et
  ajoute automatiquement les noms de ses dépendances au vocabulaire — utile pour que la dictée
  reconnaisse correctement les noms de librairies utilisées dans ce projet précis, sans avoir à les
  taper à la main.</p>
</section>

<section>
  <h1 class="section-title">8. Microphone &amp; niveau audio</h1>
  <p>Le microphone d'entrée se choisit dans <b>Réglages</b> si plusieurs sont branchés (casque, micro
  externe…). Un indicateur de niveau visible pendant l'enregistrement confirme que le son est bien
  capté avant même la fin de la dictée.</p>
</section>

<section>
  <h1 class="section-title">9. Notifications</h1>
  <p>De petites notifications discrètes (et non les notifications Windows natives, plus larges)
  confirment le démarrage, la fin et le résultat d'une transcription, même fenêtre réduite.</p>
</section>

<section>
  <h1 class="section-title">10. Historique des dictées</h1>
  <p>Chaque dictée est conservée dans <b>Historique</b> : texte, mode utilisé, fournisseur, horodatage.
  Une barre de recherche filtre instantanément le texte des dictées passées ; un clic sur une entrée la
  recopie dans le presse-papiers ; chaque entrée peut être supprimée individuellement, ou l'historique
  entier vidé.</p>
</section>

<section>
  <h1 class="section-title">11. Usage &amp; coûts</h1>
  <p>La section <b>Usage</b> cumule le temps de transcription utilisé par fournisseur, avec un taux de
  coût par minute réglable pour chacun — utile pour garder un œil sur la consommation d'un compte
  gratuit ou payant.</p>
</section>

<section>
  <h1 class="section-title">12. Clés API &amp; sécurité</h1>
  <p>Les clés des trois fournisseurs (Groq, Deepgram, OpenAI) se saisissent directement dans
  l'application — plus besoin d'éditer un fichier de configuration à la main.</p>
  <p>Elles sont stockées <b>chiffrées</b> sur le disque, via le mécanisme de sécurité natif de Windows
  (<code>safeStorage</code>, lié au compte utilisateur de la session) — pas en texte brut. Un message
  dans Réglages (🔒 Clés chiffrées sur ce PC) confirme que le chiffrement est actif.</p>
</section>

<section>
  <h1 class="section-title">13. Verrouillage rapide</h1>
  <p>Un bouton 🔓/🔒 dans la barre de titre (et le raccourci <span class="kbd">Ctrl+Alt+L</span>, modifiable)
  bascule l'application en pause : tant que verrouillé, aucun raccourci clavier ni bouton ne peut démarrer
  une dictée ou une réunion — utile pour être certain de ne rien déclencher par erreur pendant un appel
  sensible.</p>
  <p>Arrêter un enregistrement déjà en cours (ou l'annuler) reste toujours possible même verrouillé :
  seul le <i>démarrage</i> est bloqué, jamais l'arrêt.</p>
</section>

<section>
  <h1 class="section-title">14. Réglages généraux</h1>
  <p>Rassemble, en bas de l'application (menu volontairement peu consulté au quotidien) : les
  raccourcis clavier, l'ordre des fournisseurs, le vocabulaire, la durée de silence, le microphone, le
  dossier de projet, la langue du module Réunion, la durée de conservation des réunions, la gestion des
  clés API, le démarrage automatique et les mises à jour.</p>
</section>

<section>
  <h1 class="section-title">15. Module Réunion</h1>
  <p>Capture une réunion de bout en bout : audio, transcription, identification des intervenants et
  résumé — pensé pour un appel Zoom/Teams sur ce PC, ou une discussion enregistrée via le micro.</p>

  <h2><span class="icon">🎧</span>Capture micro + audio système</h2>
  <p>Le mode Réunion enregistre simultanément le microphone et l'audio joué par l'ordinateur (la voix
  des autres participants d'un appel), les mélange, et n'en fait qu'un seul flux transcrit.</p>

  <h2><span class="icon">⏱️</span>Réunions longues</h2>
  <p>L'enregistrement est automatiquement découpé en morceaux (par défaut 3 minutes) envoyés au fur et
  à mesure à la transcription, avec un léger chevauchement entre chaque morceau pour ne perdre aucun mot
  à la jointure. Cela permet de suivre la transcription en direct pendant la réunion plutôt que
  d'attendre la fin.</p>

  <h2><span class="icon">🗣️</span>Qui parle : la diarisation</h2>
  <p>Chaque phrase transcrite est associée à un numéro d'intervenant (« Intervenant 0 », « Intervenant
  1 »…) détecté automatiquement à partir des différences de voix. La précision de cette détection
  dépend de la qualité audio et de la distinction réelle entre les voix ; elle est plus fiable sur des
  voix humaines bien différenciées que sur des voix très proches.</p>
  <p>Ces numéros peuvent être renommés a posteriori (voir « Édition &amp; renommage » plus bas) — pas
  besoin de connaître les noms des intervenants avant de démarrer.</p>

  <h2><span class="icon">⌨️</span>Raccourci clavier</h2>
  <p>Le raccourci <span class="kbd">Ctrl+Alt+M</span> (modifiable dans Réglages) démarre ou arrête une
  réunion depuis n'importe où, même fenêtre réduite dans la zone de notification — une petite
  notification confirme le démarrage et la fin quand la fenêtre n'est pas visible.</p>

  <h2><span class="icon">🌐</span>Langue de la réunion</h2>
  <p>Un sélecteur Français / English dans la section Réunion détermine la langue utilisée pour la
  transcription et pour le résumé (sections en anglais quand English est choisi). Ce choix n'est pas
  détecté automatiquement : il faut le sélectionner avant de démarrer une réunion tenue dans une autre
  langue que le français.</p>

  <h2><span class="icon">📝</span>Résumé automatique</h2>
  <p>À la fin de l'enregistrement, un résumé structuré est généré par IA en trois parties : un résumé
  général, les décisions prises, et les actions à faire (avec la personne responsable quand elle est
  identifiable dans les échanges).</p>

  <h2><span class="icon">🗂️</span>Réunions enregistrées</h2>
  <p>Chaque réunion terminée est automatiquement sauvegardée et apparaît dans la section
  <b>Réunions enregistrées</b> : titre généré automatiquement à partir du résumé, date, durée. La
  barre de recherche filtre non seulement sur le titre mais aussi sur le contenu complet — résumé et
  transcript — pratique pour retrouver une réunion à partir d'un mot ou d'un nom mentionné dedans, même
  s'il n'apparaît pas dans le titre. Un clic déplie le résumé et le transcript complet ; un bouton
  supprime la réunion (fichier compris).</p>
  <p>Le titre est <b>librement modifiable</b> : clique dedans et tape ce que tu veux (client, sujet…) — la
  date reste affichée juste à côté séparément, pas besoin de la répéter dans le titre.</p>

  <h2><span class="icon">✏️</span>Édition, renommage &amp; correction de termes</h2>
  <p>Dans une réunion dépliée, un bouton <b>✏️ Modifier</b> permet de corriger librement le texte du
  résumé ou du transcript après coup. Si des « Intervenant N » sont détectés, un petit formulaire propose
  de les renommer un par un.</p>
  <p>Un second formulaire, <b>« Corriger un terme »</b>, permet de remplacer en un clic <i>toutes</i> les
  occurrences d'un mot mal reconnu (par exemple « QuantiDAR » → « QuantStudio ») dans l'ensemble du
  document — pas besoin de corriger chaque passage un par un. Insensible à la casse (une même erreur peut
  apparaître différemment orthographiée d'un passage à l'autre). Tous ces remplacements sont écrits
  directement dans le fichier, donc visibles aussi dans un futur export PDF.</p>
  <p>Si le résumé automatique a échoué (clé API manquante, panne réseau…), un avertissement visible
  ⚠️ remplace désormais le résumé attendu — auparavant ceci passait inaperçu, laissant juste le transcript
  brut sans explication. Le bouton <b>🔁 Régénérer le résumé</b> relance uniquement la génération du
  résumé (sans retranscrire l'audio) ; il ne touche jamais à un titre déjà personnalisé.</p>

  <h2><span class="icon">📥</span>Import de transcript externe</h2>
  <p>Le bouton <b>📥 Importer un transcript</b> permet de coller (ou charger depuis un fichier .txt) un
  texte déjà transcrit ailleurs pour lui appliquer le même résumé IA et le retrouver dans la liste, avec
  un badge « Importé ».</p>
  <p>Le bouton <b>🎵 Importer un fichier audio</b> (juste en dessous) fait la même chose à partir d'un
  fichier audio existant (.m4a, .mp3, .wav…) plutôt que d'un texte déjà transcrit — par exemple la piste
  audio exportée d'une note Notability sur iPad. Le fichier est envoyé à la transcription avec
  diarisation, comme pour une vraie réunion enregistrée dans l'app.</p>
  <p>Dans les deux cas, ce n'est pas une intégration directe avec Notability (aucune passerelle
  automatique n'existe entre les deux applications) : le fichier doit être transféré manuellement.</p>

  <h2><span class="icon">🗑️</span>Rétention automatique</h2>
  <p>Un réglage dans Réglages (« Conserver les réunions ») supprime automatiquement les réunions plus
  anciennes que le délai choisi (90 jours par défaut, 0 = jamais) — fichier et entrée dans la liste
  disparaissent ensemble, au démarrage de l'application.</p>

  <h2><span class="icon">📄</span>Export PDF</h2>
  <p>Chaque réunion (depuis la liste, ou juste après l'avoir terminée) peut être exportée en PDF via le
  bouton <b>⬇ PDF</b> — une boîte de dialogue Windows classique propose ensuite où l'enregistrer,
  pratique pour l'archiver ou le partager en dehors de l'application (par exemple en l'important dans
  Notability sur iPad).</p>

  <h2><span class="icon">⚠️</span>Limites connues</h2>
  <ul>
    <li>La diarisation identifie des <i>numéros</i> d'intervenants au départ — le renommage manuel comble
      cette limite après coup, mais rien n'associe automatiquement un numéro à un nom.</li>
    <li>Enregistrer un appel (surtout externe, avec des clients ou partenaires) soulève des questions de
      confidentialité — consentement des participants, politique interne de l'entreprise — à vérifier
      avant un usage professionnel réel, indépendamment de ce que permet l'outil techniquement.</li>
  </ul>
</section>

<section>
  <h1 class="section-title">16. Mises à jour automatiques</h1>
  <p>L'application vérifie automatiquement, à chaque lancement, si une nouvelle version est disponible ;
  si oui, elle la télécharge en arrière-plan et l'installe au prochain redémarrage de l'application (ou
  immédiatement via le bouton <b>Redémarrer et installer</b> une fois le téléchargement terminé).</p>
  <p>Dans Réglages, la section <b>Mises à jour</b> affiche la version actuelle et propose un bouton
  <b>Vérifier maintenant</b> pour forcer une vérification immédiate plutôt que d'attendre le prochain
  lancement.</p>
</section>

<section>
  <h1 class="section-title">17. Astuces</h1>
  <ul>
    <li>Pour une dictée technique précise, ajouter les termes récurrents au vocabulaire plutôt que
      compter sur la reconnaissance seule.</li>
    <li>Ouvrir un projet dans le champ dédié une seule fois : le vocabulaire technique associé se
      régénère automatiquement, pas besoin de le refaire à chaque session.</li>
    <li>Pour une réunion en anglais, penser à basculer le sélecteur de langue <i>avant</i> de démarrer
      — la transcription en cours ne peut pas changer de langue rétroactivement.</li>
    <li>Verrouiller (Ctrl+Alt+L) avant un appel où l'on ne veut surtout rien déclencher par erreur —
      plus rapide que de fermer l'application.</li>
  </ul>
</section>

<section>
  <h1 class="section-title">18. Dépannage rapide</h1>
  <table>
    <tr><th>Symptôme</th><th>Piste</th></tr>
    <tr><td>Un raccourci ne répond pas</td><td>Un autre logiciel l'utilise déjà — le changer dans Réglages (un raccourci en conflit y est signalé). Vérifier aussi que l'application n'est pas verrouillée (icône 🔒).</td></tr>
    <tr><td>« Clé API manquante »</td><td>Renseigner la clé du fournisseur concerné dans Réglages → Clés API.</td></tr>
    <tr><td>La réunion ne capte pas le son des autres participants</td><td>Vérifier que l'audio système est bien autorisé au niveau de Windows pour l'application.</td></tr>
    <tr><td>La transcription semble tronquée en anglais</td><td>Vérifier que le sélecteur de langue de la réunion était bien sur English avant de démarrer.</td></tr>
    <tr><td>« Vérifier maintenant » signale une erreur</td><td>Normal en mode développement (npm run dev) ; sur une version installée, vérifier la connexion internet.</td></tr>
  </table>
</section>

</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:8px; width:100%; text-align:center; color:#8a8a8a; -webkit-print-color-adjust: exact;">TransAudiOli — page <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    })
    await writeFile(outputPath, pdfBuffer)
    console.log('MANUAL_OK', outputPath, pdfBuffer.length)
  } catch (error) {
    console.error('MANUAL_FAIL', error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
