// Organisationen — echte RLCS-Orgas (aktuell + historisch), verifiziert über
// Liquipedia (Portal:Teams, Team-Einzelseiten, RLCS-History-Seite), nicht aus
// dem Gedächtnis geraten. Budget ist ein reiner Spielwert für das Balancing,
// KEINE echte Einschätzung der realen Organisationen (siehe Disclaimer im
// Hauptmenü/KONZEPT.md). `description` ist ein kurzer Flavourtext pro Org --
// wo recherchierbar an echten Fakten orientiert (Gründungshintergrund,
// Region, Markenidentität), sonst zum jeweiligen Organisationstyp passend
// erfunden. Ersetzt das frühere Pro/Con-System (User-Wunsch: keine
// Boni/Mali-Texte mehr, nur noch eine Beschreibung).
//
// `strength` steht NICHT mehr hier in der Rohliste -- es gibt keine
// autorierte Stärke pro Org mehr. Stattdessen wird jedem Spieler/Mitarbeiter
// beim Kaderaufbau (generateOrgRoster() in org-rosters.js) unabhängig von
// seiner Org eine gleichmäßig über 0,5-5 Sterne verteilte Bewertung
// zugewiesen, und `strength` ergibt sich danach als Durchschnitt des
// gesamten Kaders (computeOrgStrengthFromRoster(), s.u.) -- User-Korrektur:
// "die orga soll anhand der spieler und dem staff der stärke zugeordnet
// sein" (nicht umgekehrt, wie in einer ersten, falschen Version).
//
// User-Wunsch: statt zufälliger Zuweisung wählt man seine Org jetzt selbst aus
// einem Menü (siehe renderer.js goToOrgSelection()). Eine gewählte Org darf
// danach kein Bot-Team mehr tragen (siehe data/bot-teams.js).
//
// Budget-Formel: direkt aus dem Marktwert des festen Start-Kaders abgeleitet
// (siehe data/org-rosters.js generateOrgRoster()) plus 40% Spielraum für
// Reserve-Spieler/Verstärkungen -- garantiert für JEDE Org ein positives
// "Verbleibend" beim Kaderstart (User-Wunsch: "echter Startkader" statt
// freiem Draft, siehe confirmOrgAndProceed() in renderer.js).
// Match-Bonus: (Stärke - 84) * 0.4 Prozentpunkte (unverändert, jetzt aber
// stärkeabhängig von der aus dem Kader berechneten Stärke).
const ORG_BUDGET_HEADROOM = 1.4;

function computeOrgBudget(roster) {
  const rosterValue = roster.starters.reduce((sum, p) => sum + calculatePrice(p.overall), 0)
    + calculatePrice(roster.sub.overall)
    + calculatePrice(roster.coach.overall);
  return Math.round((rosterValue * ORG_BUDGET_HEADROOM) / 10000) * 10000;
}

function computeMatchBonusPct(strength) {
  return Math.round((strength - 84) * 0.4 * 10) / 10;
}

// name + country (echter Firmensitz, per Websuche gegen Liquipedia/Wikipedia/
// offizielle Org-Seiten verifiziert, NICHT aus dem Gedächtnis geraten —
// analog zur bisherigen Namens-Recherche). Kein `strength`-Feld mehr hier,
// siehe Kommentar oben.
// `country: null` bei drei Orgs ohne festen Firmensitz (lose organisierte
// EU-Teams ohne Liquipedia-Länderangabe: The Bricks, Bonk!, We Dem Girlz) --
// dort wird in der UI bewusst keine Flagge geraten, sondern keine gezeigt.
//
// `logo` (optional): Dateiname in assets/team-logos/, für Orgas, zu denen der
// User echte Team-Logo-Grafiken bereitgestellt hat (User-Wunsch: "sämtliche
// team logos die du für orga auswahl verwenden sollst"). Orgas ohne `logo`
// fallen in der UI auf ein generiertes Farb-Badge zurück (siehe
// orgBadgeColor() in renderer.js) — bewusst KEINE echten Marken-Logos
// selbst beschafft/heruntergeladen (Marken-/Urheberrechts-Risiko), aber vom
// User bereitgestellte Dateien werden hier eingebunden.
const ORGANIZATIONS_RAW = [
  // Aktuell aktive Top-Orgas
  { name: 'Team Vitality', country: 'FR', logo: 'Team_Vitality.png', description: 'Eine der größten Multi-Game-Organisationen Europas, 2013 in Paris gegründet — riesige Fanbase und Top-Sponsoren über praktisch jedes große Esport-Game hinweg.' },
  { name: 'Karmine Corp', country: 'FR', logo: 'Karmine_Corp.png', description: '2020 von den Streamern Kameto und ZeratoR gegründet — in wenigen Jahren zur Kult-Organisation mit einer der lautesten, loyalsten Fanbases Europas geworden.' },
  { name: 'NRG', country: 'US', logo: 'NRG.png', description: 'US-Organisation aus Los Angeles mit prominenten Investoren im Rücken — professionelle Strukturen und ambitionierte Ziele in praktisch jedem großen Titel.' },
  { name: 'Team Falcons', country: 'SA', logo: 'Team_Falcons.png', description: 'Saudi-arabische Organisation mit enormem finanziellem Rückhalt — seit wenigen Jahren auf dem Vormarsch und investiert gezielt in absolute Top-Talente.' },
  { name: 'FURIA', country: 'BR', logo: 'FURIA.png', description: 'Brasilianische Organisation mit einer der leidenschaftlichsten Fanbases der Szene — bekannt für aggressive, unterhaltsame Spielweise und lautstarke Unterstützung.' },
  { name: 'Gen.G Mobil1 Racing', country: 'US', logo: 'Gen.G_Mobil1_Racing.png', description: 'Ableger der global aktiven Gen.G-Organisation mit Wurzeln im koreanischen Esport — bringt professionelle, international erprobte Strukturen in die Liga.' },
  { name: 'Spacestation Gaming', country: 'US', logo: 'Spacestation_Gaming.png', description: 'US-Organisation mit langer Rocket-League-Geschichte — bekannt für soliden Spielaufbau und Beständigkeit statt kurzfristiger Hypes.' },
  { name: 'Dignitas', country: 'US', logo: 'Dignitas.png', description: 'Eine der ältesten Esport-Organisationen überhaupt, gegründet 2003 — über zwei Jahrzehnte Erfahrung im Wettkampf-Geschäft.' },
  { name: 'Twisted Minds', country: 'SA', logo: 'Twisted_Minds.png', description: 'Saudi-arabische Organisation mit wachsendem Einfluss in der MENA-Region — junges Management mit großen Ambitionen.' },
  { name: 'Gentle Mates', country: 'FR', logo: 'Gentle_Mates.png', description: 'Französische Organisation aus dem Umfeld bekannter Streamer — setzt stark auf Community-Nähe und Unterhaltungswert.' },
  { name: 'Ninjas in Pyjamas', country: 'SE', logo: 'Ninjas_in_Pyjamas.png', description: 'Traditionsreiche schwedische Organisation mit einer der bekanntesten Marken im gesamten Esport — Tradition trifft auf modernen Anspruch.' },
  { name: 'Moist Esports', country: 'US', description: 'Aus der Streaming-Community entstandene Organisation — lockere, unterhaltungsorientierte Kultur mit direktem Draht zu den Fans.' },
  { name: 'Endpoint', country: 'GB', description: 'Britische Organisation mit gutem Ruf für Nachwuchsförderung — bekannt dafür, jungen Talenten den Sprung in die Weltspitze zu ermöglichen.' },
  { name: 'GameWard', country: 'FR', logo: 'GameWard.png', description: 'Französische Organisation mit stabiler Wettbewerbsstruktur — bekannt für diszipliniertes, gut organisiertes Teammanagement.' },
  { name: 'NOVO Esports', country: 'IT', logo: 'NOVO_Esports.png', description: 'Italienische Organisation mit wachsender Präsenz im europäischen Wettbewerb — kleiner, aber ambitionierter Kader mit viel Entwicklungspotenzial.' },
  { name: 'The Bricks', country: null, description: 'Lose organisiertes Team ohne festen Firmensitz — funktioniert eher wie ein eingespieltes Freundes-Kollektiv als wie ein klassischer Konzern.' },
  { name: 'Lilmix', country: 'SE', description: 'Schwedische Organisation mit bodenständiger, unaufgeregter Herangehensweise — Substanz statt große Show.' },
  { name: 'Bonk!', country: null, description: 'Organisation ohne festen Firmensitz mit erfrischend unkonventionellem Auftreten — der Name ist Programm.' },
  // Historische Orgas (verifiziert über Liquipedia) — seit Jahren ohne
  // aktuellen Spitzenerfolg, aber als Traditionsorgas spielbar.
  { name: 'Cloud9', country: 'US', description: 'Eine der ikonischsten nordamerikanischen Organisationen der Esport-Geschichte, gegründet 2013 — Titel in zahlreichen Spielen über die Jahre.' },
  { name: 'G2 Esports', country: 'DE', description: 'In Berlin gegründete Organisation, die sich zu einer der größten und wertvollsten Marken im globalen Esport entwickelt hat.' },
  { name: 'Renegades', country: 'US', description: 'Ursprünglich in Australien gegründete Organisation, mittlerweile mit US-Ausrichtung — bewegte Geschichte mit mehreren Neuausrichtungen.' },
  { name: 'Rogue', country: 'US', description: 'US-Organisation mit wechselhafter, aber langer Wettbewerbsgeschichte — mal ganz oben, mal im Umbruch.' },
  { name: 'Ghost Gaming', country: 'US', description: 'US-Organisation, die sich vor allem durch bodenständiges Teammanagement und geduldigen Kaderaufbau auszeichnet.' },
  { name: 'PSG Esports', country: 'FR', description: 'Die Esport-Sparte des französischen Fußball-Riesen Paris Saint-Germain — bringt Glanz und Ressourcen eines der größten Sportvereine der Welt mit.' },
  { name: 'iBUYPOWER', country: 'US', description: 'Von einem bekannten PC-Hardware-Hersteller getragene Organisation — technikaffines Umfeld mit direktem Draht zur Gaming-Industrie.' },
  { name: 'FlipSid3 Tactics', country: 'US', description: 'Organisation mit Wurzeln in der frühen Wettkampfszene — bemüht, an alte Erfolge anzuknüpfen.' },
  { name: 'Northern Gaming', country: 'CA', description: 'Kanadische Organisation mit Fokus auf nordamerikanisches Nachwuchstalent.' },
  { name: 'Kings of Urban', country: 'US', description: 'US-Organisation mit urbaner, selbstbewusster Markenidentität und wachsender Fanbase.' },
  { name: 'Mock-It Esports', country: 'US', description: 'Kleinere US-Organisation, die sich durch unkonventionelle, oft humorvolle Außendarstellung von der Konkurrenz abhebt.' },
  { name: 'Chiefs Esports Club', country: 'AU', description: 'Australische Organisation mit langer Geschichte in der ozeanischen Wettkampfszene — feste Größe der Region seit vielen Jahren.' },
  { name: 'Evil Geniuses', country: 'US', description: 'Eine der ältesten und angesehensten Organisationen im gesamten Esport, gegründet 1999 — legendärer Name mit entsprechend hohem Anspruch.' },
  { name: 'Complexity Gaming', country: 'US', description: 'Traditionsreiche US-Organisation seit 2003 — über zwei Jahrzehnte durchgängige Präsenz im Wettkampf-Esport.' },
  { name: 'Envy', country: 'US', description: 'Etablierte US-Organisation mit langer Multi-Game-Geschichte — bekannt für solide, professionelle Strukturen.' },
  { name: 'OpTic Gaming', country: 'US', description: 'Kult-Organisation mit einer der treuesten Fanbases im gesamten Esport (die legendäre Green Wall) — Tradition und Emotion in gleichem Maße.' },
  { name: 'Splyce', country: 'US', description: 'Organisation mit internationaler Wettkampfgeschichte über mehrere große Titel hinweg.' },
  { name: 'Selfless Gaming', country: 'US', description: 'Kleinere US-Organisation mit familiärem Umfeld und kurzen Entscheidungswegen.' },
  { name: 'We Dem Girlz', country: null, description: 'Ungewöhnlich benannte, lose organisierte Truppe ohne festen Firmensitz — Spaß am Spiel steht klar vor Konzernstrukturen.' },
  // Logo-Paket: zusätzliche echte Rocket-League-Teams (per Liquipedia
  // verifiziert — Name + Firmensitz bestätigt, Stärke bleibt reiner
  // Spielwert grob aus der recherchierten Wettbewerbsstufe abgeleitet, keine
  // exakte Leistungseinschätzung). Eine Logo-Datei ("1.png", Org hieß
  // buchstäblich "1") wurde bewusst NICHT übernommen — kürzlich aufgelöst
  // und ein einzelnes Zeichen als Orga-Name würde in der UI wie ein Darstellungsfehler wirken.
  { name: 'Shopify Rebellion', country: 'CA', logo: 'Shopify_Rebellion.png', description: 'Vom kanadischen E-Commerce-Riesen Shopify unterstützte Organisation — finanzstark und mit klarer Wachstumsstrategie über mehrere Titel.' },
  { name: 'MIBR', country: 'BR', logo: 'MIBR.png', description: 'Made in Brazil — legendärer brasilianischer Traditionsname mit tief verwurzeltem Nationalstolz und einer riesigen Fanbase.' },
  { name: 'Manchester City Esports', country: 'GB', logo: 'Manchester_City_Esports.png', description: 'Die Esport-Abteilung des englischen Fußball-Topclubs Manchester City — professionelle Strukturen direkt aus dem Profifußball übernommen.' },
  { name: 'TSM', country: 'US', logo: 'TSM.png', description: 'Eine der bekanntesten Marken im nordamerikanischen Esport — riesige Fanbase, hoher Erwartungsdruck, große Bühne.' },
  { name: 'FUT Esports', country: 'TR', logo: 'FUT_Esports.png', description: 'Türkische Organisation mit stabiler Position in der Region — solide Strukturen ohne große Allüren.' },
  { name: 'R8 Esports', country: 'SA', logo: 'R8_Esports.png', description: 'Saudi-arabische Organisation mit wachsendem Ehrgeiz in der MENA-Wettkampfszene.' },
  { name: 'PWR', country: 'AU', logo: 'PWR.png', description: 'Australische Organisation mit Fokus auf die ozeanische Region — kleiner Kader, große Ambitionen.' },
  { name: 'Wildcard', country: 'US', logo: 'Wildcard.png', description: 'US-Organisation mit unberechenbarem, mutigem Spielstil — der Name ist Programm.' },
  { name: 'Five Fears', country: 'US', logo: 'Five_Fears.png', description: 'Junge US-Organisation, die sich einen aggressiven, furchtlosen Ruf erarbeiten will.' },
  { name: 'Virtus.pro', country: 'AM', logo: 'Virtus.pro.png', description: 'Eine der prestigeträchtigsten Organisationen aus der GUS-Region — Tradition, große Erfolge und eine riesige internationale Fanbase.' },
  { name: 'KINOTROPE gaming', country: 'JP', logo: 'KINOTROPE_gaming.png', description: 'Japanische Organisation mit Fokus auf technisch präzises, diszipliniertes Spiel.' },
  { name: 'Pioneers', country: 'US', logo: 'Pioneers.png', description: 'US-Organisation, die sich bewusst als Vorreiter neuer Strategien und Herangehensweisen versteht.' },
  { name: 'Team Secret', country: 'NL', logo: 'Team_Secret.png', description: 'International bekannte Organisation mit niederländischen Wurzeln und großem Renommee, vor allem aus dem Dota-2-Umfeld.' },
  { name: 'M80', country: 'US', logo: 'M80.png', description: 'Junge US-Organisation im Aufbau — kleiner Etat, aber klarer Plan für die Zukunft.' },
  { name: 'Team Vision', country: 'SA', logo: 'Team_Vision.png', description: 'Saudi-arabische Organisation mit langfristiger strategischer Ausrichtung statt kurzfristiger Ergebnisse.' },
  { name: 'WYLDE', country: 'IE', logo: 'WYLDE.png', description: 'Irische Organisation mit kleiner, aber sehr engagierter Fanbase.' },
  { name: 'Infamous', country: 'SA', logo: 'Infamous.png', description: 'Saudi-arabische Organisation mit provokant-selbstbewusstem Auftreten.' },
  { name: 'BS+COMPETITION', country: 'DE', logo: 'BS+COMPETITION.png', description: 'Deutsche Organisation mit bodenständiger, unaufgeregter Wettkampfmentalität.' },
  { name: '77Blocks', country: 'DE', logo: '77Blocks.png', description: 'Deutsche Organisation mit wachsender Präsenz in der europäischen Community-Szene.' },
  { name: 'BTF Esports', country: 'NL', logo: 'BTF_Esports.png', description: 'Niederländische Organisation mit solider, unaufgeregter Kaderpolitik.' },
  { name: 'Canterbury-Bankstown Bulldogs', country: 'AU', logo: 'Canterbury-Bankstown_Bulldogs.png', description: 'Esport-Ableger eines traditionsreichen australischen Sportvereins — bringt echte Vereinskultur und eine treue Fanbase mit ins Rennen.' },
  { name: 'Death Cloud Esports', country: 'GB', logo: 'Death_Cloud_Esports.png', description: 'Britische Organisation mit düsterem Branding und kompromisslosem Wettkampfanspruch.' },
  { name: 'Deleted Gaming', country: 'US', logo: 'Deleted_Gaming.png', description: 'US-Organisation mit ungewöhnlichem Namen und einer kleinen, aber loyalen Fanbase.' },
  { name: 'GracesBlaze', country: 'JP', logo: 'GracesBlaze.png', description: 'Japanische Organisation mit Fokus auf präzises, kontrolliertes Spiel.' },
  { name: 'Nova Esports', country: 'OM', logo: 'Nova_Esports.png', description: 'Organisation aus dem Oman mit wachsender Bedeutung für die Golfregion im Esport.' },
  { name: 'NuTorious', country: 'US', logo: 'NuTorious.png', description: 'US-Organisation, die sich bewusst einen unkonventionellen, aufmerksamkeitsstarken Namen gegeben hat.' },
  { name: 'Overlooked', country: 'US', logo: 'Overlooked.png', description: 'US-Organisation, deren Name Programm ist — will sich aus dem Schatten der großen Marken herausspielen.' },
  { name: 'Sunset', country: 'BR', logo: 'Sunset.png', description: 'Brasilianische Organisation mit ruhigem, entspanntem Markenauftritt.' },
  { name: 'Unreal Nightmare', country: 'US', logo: 'Unreal_Nightmare.png', description: 'US-Organisation mit schrillem Namen und entsprechend unberechenbarer Spielweise.' },
  { name: 'WIP Esports', country: 'FR', logo: 'WIP_Esports.png', description: 'Französische Organisation im permanenten Aufbau — Work in Progress als Selbstverständnis.' },
  { name: 'WOO', country: 'FR', logo: 'WOO.png', description: 'Kleine französische Organisation mit familiärer Atmosphäre.' },
  { name: 'Zookeepers', country: 'US', logo: 'Zookeepers.png', description: 'US-Organisation mit verspieltem Branding und einer bunt gemischten, chaotisch-liebenswerten Fanbase.' },
  { name: '25 Shot Club', country: 'AR', logo: '25_Shot_Club.png', description: 'Argentinische Organisation mit südamerikanischem Kampfgeist.' },
  { name: 'Enisorail', country: 'FR', logo: 'Enisorail.png', description: 'Französische Organisation mit ruhigem, methodischem Kaderaufbau.' },
  { name: 'FIZ6 Gaming', country: 'AU', logo: 'FIZ6_Gaming.png', description: 'Australische Organisation mit kleinem, aber eingeschworenem Kern-Team.' },
  { name: "Jungle Juicers", country: null, logo: 'Jungle_Juicers.png', description: 'Locker organisierte Truppe ohne festen Firmensitz — Spaß und Teamgeist stehen im Vordergrund.' },
  { name: "L'antique Esport", country: 'FR', logo: "L'antique_Esport.png", description: 'Französische Organisation, die bewusst mit klassischer, traditioneller Namensgebung auftritt.' },
  { name: 'Lotus 8 Esports', country: 'CA', logo: 'Lotus_8_Esports.png', description: 'Kanadische Organisation mit ruhigem, meditativ anmutendem Markenbild.' },
  { name: 'Str1ve eSports', country: 'PT', logo: 'Str1ve_eSports.png', description: 'Portugiesische Organisation mit dem klaren Anspruch, sich stetig zu verbessern.' },
  { name: 'GriddyGoose', country: null, logo: 'GriddyGoose.png', description: 'Ohne festen Firmensitz organisierte Truppe mit ausgeprägtem Sinn für Humor.' },
  { name: 'NORTHSTAR', country: null, logo: 'NORTHSTAR.png', description: 'Lose organisiertes Team ohne festen Firmensitz mit großen, hochfliegenden Ambitionen.' },
  { name: 'God Speed', country: 'US', logo: 'God_Speed.png', description: 'US-Organisation, die auf schnelles, aggressives Spieltempo setzt.' },
  { name: 'Team BSK', country: 'FR', logo: 'Team_BSK.png', description: 'Französische Organisation mit kleinem, familiärem Umfeld.' },
  { name: 'Revelation', country: 'US', logo: 'Revelation.png', description: 'US-Organisation mit dem Anspruch, mit unerwarteten Ergebnissen zu überraschen.' },
  { name: 'NTX Esports', country: 'US', logo: 'NTX_Esports.png', description: 'US-Organisation mit texanischen Wurzeln und bodenständiger Mentalität.' },
  { name: 'Next2Nu Esports', country: 'US', logo: 'Next2Nu_Esports.png', description: 'Junge US-Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt.' },
  { name: 'Dangerous Esports Club', country: 'IT', logo: 'Dangerous_Esports_Club.png', description: 'Italienische Organisation mit selbstbewusst-aggressivem Markenauftritt.' },
  { name: 'Team Silenced', country: 'PR', logo: 'Team_Silenced.png', description: 'Organisation aus Puerto Rico mit kleiner, aber wachsender Wettkampfpräsenz in der Karibik.' },
  { name: '445', country: 'US', logo: '445.png', description: 'US-Organisation mit ungewöhnlichem, zahlenbasiertem Namen und eigenständigem Auftreten.' },
  { name: 'Godalions', country: 'GB', logo: 'Godalions.png', description: 'Britische Organisation mit stolzem, löwenhaftem Markenbild.' },

  // ── Fiktive Zusatz-Orgas (Runde 45) ─────────────────────────────────────
  // Die 87 Orgas oben sind ECHTE, recherchierte RLCS-Organisationen (siehe
  // Kommentar am Dateianfang). Für "1:1 RLCS"-Regional-Qualifier braucht
  // jede der 7 Regionen genug Teams, um einen echten Open-Bracket zu füllen
  // (User-Vorgabe: "füge so viele hinzu dass genug für jede Region da
  // wäre" -- ein echter Open hat tausende Teilnehmer, das lässt sich ohne
  // erfundene Orgas nicht mäßig simulieren). Die 149 Orgas unten sind
  // deshalb bewusst KOMPLETT FIKTIV (Namens-Kombinatorik, deterministisch
  // per Seed generiert, siehe scratchpad-Skript dieser Runde) -- keine
  // echten Marken/Organisationen, kein Rechercheanspruch, rein zur
  // Feld-Auffüllung. Jede Region landet dadurch bei mindestens 32 Teams
  // (EU 27->32, NA bereits 38 unverändert, MENA 6->32, SAM 4->32, OCE
  // 4->32, APAC 2->32, SSA 0->32). Kein `logo`-Feld (fallen auf den
  // Buchstaben-Platzhalter zurück, wie einige der echten Orgas oben auch).
  { name: 'Draco Kings', country: 'IT', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Eclipse Squad', country: 'BE', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // EU
  { name: 'Falcon Dynasty', country: 'NL', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Nova Rebels', country: 'DE', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Helix Syndicate', country: 'PL', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // EU
  { name: 'Rogue Wolves', country: 'CL', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SAM
  { name: 'Draco Syndicate', country: 'CL', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Omega Vanguard', country: 'BR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Raptor Esports', country: 'CL', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Surge Kings', country: 'CL', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SAM
  { name: 'Obsidian Nation', country: 'AR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Magma Reign', country: 'AR', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Orbit Reign', country: 'CL', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Meteor Force', country: 'AR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SAM
  { name: 'Quake Titans', country: 'CL', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Quantum Dynasty', country: 'AR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Jolt Reign', country: 'BR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SAM
  { name: 'Umbra Titans', country: 'AR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Pulse Wolves', country: 'BR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Ignite Hawks', country: 'AR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Titan Vanguard', country: 'AR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Ignite Squad', country: 'CL', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Viper Vanguard', country: 'AR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Magma Legion', country: 'CL', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Orbit Company', country: 'BR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Havoc Gaming', country: 'CL', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Rogue Core', country: 'CL', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SAM
  { name: 'Ignite Core', country: 'CL', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SAM
  { name: 'Solar Vanguard', country: 'AR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Omega Legion', country: 'CL', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SAM
  { name: 'Pulse Guild', country: 'BR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Fusion Dynasty', country: 'AR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Axiom Wolves', country: 'AR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Prime Collective', country: 'OM', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Zenith Alliance', country: 'OM', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // MENA
  { name: 'Zenith Gaming', country: 'SA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Krypton Titans', country: 'SA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // MENA
  { name: 'Ion Esports', country: 'EG', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Zenith Squad', country: 'SA', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Frost Dynasty', country: 'EG', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Hydra Crew', country: 'OM', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Solar Gaming', country: 'SA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Dusk United', country: 'SA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // MENA
  { name: 'Granite Kings', country: 'EG', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // MENA
  { name: 'Lunar Hawks', country: 'MA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Phantom Kings', country: 'EG', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // MENA
  { name: 'Granite Hawks', country: 'EG', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Umbra Gaming', country: 'EG', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // MENA
  { name: 'Storm Syndicate', country: 'MA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // MENA
  { name: 'Zenith Kings', country: 'SA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // MENA
  { name: 'Storm Company', country: 'EG', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // MENA
  { name: 'Riptide Company', country: 'EG', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // MENA
  { name: 'Draco United', country: 'EG', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // MENA
  { name: 'Lunar Gaming', country: 'EG', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // MENA
  { name: 'Optic Rebels', country: 'EG', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // MENA
  { name: 'Cobra Crew', country: 'EG', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Kinetic Gaming', country: 'OM', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // MENA
  { name: 'Apex Academy', country: 'MA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // MENA
  { name: 'Shadow Titans', country: 'OM', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Catalyst Wolves', country: 'NZ', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Wraith Titans', country: 'NZ', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Blaze Academy', country: 'AU', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // OCE
  { name: 'Vortex Wave', country: 'NZ', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Ember Guild', country: 'NZ', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // OCE
  { name: 'Rogue Alliance', country: 'NZ', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Zenith Titans', country: 'NZ', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // OCE
  { name: 'Jolt Company', country: 'AU', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // OCE
  { name: 'Catalyst Core', country: 'NZ', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Kaon Alliance', country: 'AU', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // OCE
  { name: 'Catalyst Rebels', country: 'NZ', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // OCE
  { name: 'Nimbus United', country: 'NZ', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // OCE
  { name: 'Ignite Force', country: 'AU', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Phantom Reign', country: 'NZ', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Storm Rebels', country: 'NZ', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Viper Titans', country: 'NZ', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Storm Wave', country: 'NZ', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // OCE
  { name: 'Kinetic Legion', country: 'AU', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Nova Alliance', country: 'NZ', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // OCE
  { name: 'Magma Guild', country: 'AU', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Jetstream Crew', country: 'NZ', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // OCE
  { name: 'Aether Wolves', country: 'NZ', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // OCE
  { name: 'Luminous Reign', country: 'NZ', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Nova Vanguard', country: 'AU', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // OCE
  { name: 'Crimson Vanguard', country: 'NZ', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Onyx Gaming', country: 'NZ', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // OCE
  { name: 'Ion Alliance', country: 'AU', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // OCE
  { name: 'Storm Nation', country: 'NZ', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // OCE
  { name: 'Ember Company', country: 'JP', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Crimson Club', country: 'KR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Aether Kings', country: 'JP', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Echo Alliance', country: 'JP', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Falcon Esports', country: 'JP', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // APAC
  { name: 'Riptide Nation', country: 'KR', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Ferox Alliance', country: 'KR', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Aether Esports', country: 'JP', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Prism Core', country: 'JP', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Granite Crew', country: 'JP', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // APAC
  { name: 'Lunar Crew', country: 'KR', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Shadow Hawks', country: 'JP', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // APAC
  { name: 'Helix Guild', country: 'KR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Fusion Hawks', country: 'KR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // APAC
  { name: 'Frost Company', country: 'JP', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // APAC
  { name: 'Rogue Dynasty', country: 'KR', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // APAC
  { name: 'Volt Alliance', country: 'KR', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // APAC
  { name: 'Radiant Force', country: 'JP', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Umbra Guild', country: 'JP', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // APAC
  { name: 'Granite Alliance', country: 'JP', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // APAC
  { name: 'Fusion Wolves', country: 'JP', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // APAC
  { name: 'Optic United', country: 'KR', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // APAC
  { name: 'Prism Vanguard', country: 'JP', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Vortex Nation', country: 'JP', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // APAC
  { name: 'Ignite Academy', country: 'JP', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // APAC
  { name: 'Hydra Squad', country: 'JP', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // APAC
  { name: 'Raptor Titans', country: 'JP', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Phantom Club', country: 'KR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Riptide Club', country: 'JP', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // APAC
  { name: 'Obsidian Force', country: 'JP', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // APAC
  { name: 'Draco Esports', country: 'ZA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SSA
  { name: 'Pulse Kings', country: 'ZA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SSA
  { name: 'Fusion Nation', country: 'ZA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SSA
  { name: 'Kaon Nation', country: 'ZA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SSA
  { name: 'Pulse Vanguard', country: 'ZA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SSA
  { name: 'Axiom Rebels', country: 'ZA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SSA
  { name: 'Neon Hawks', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Specter Rebels', country: 'ZA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SSA
  { name: 'Ion Rebels', country: 'ZA', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SSA
  { name: 'Omega Kings', country: 'ZA', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SSA
  { name: 'Storm Alliance', country: 'ZA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SSA
  { name: 'Ferox Company', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Comet Alliance', country: 'ZA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SSA
  { name: 'Granite Collective', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Riptide Vanguard', country: 'ZA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SSA
  { name: 'Echo Collective', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Ember Rebels', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Quantum United', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Lunar Force', country: 'ZA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SSA
  { name: 'Hydra Alliance', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Ember Nation', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Eclipse Wave', country: 'ZA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SSA
  { name: 'Specter Esports', country: 'ZA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SSA
  { name: 'Umbra Wolves', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Tempest Squad', country: 'ZA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // SSA
  { name: 'Nimbus Dynasty', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Catalyst Academy', country: 'ZA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SSA
  { name: 'Krypton Collective', country: 'ZA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SSA
  { name: 'Ferox Wolves', country: 'ZA', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SSA
  { name: 'Meteor Kings', country: 'ZA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SSA
  { name: 'Ignite Kings', country: 'ZA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // SSA
  { name: 'Helix Core', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA

  // ── Fiktive Zusatz-Orgas (Runde 91) ─────────────────────────────────────
  // User-Wunsch: "Füge für jede Region nochmals 32 Teams hinzu damit man für
  // jede Region 64 Teams hat die alle im ersten Turnier teilnehmen damit das
  // Auslos-Verfahren Sinn ergibt im ersten Turnier" -- die Runde-45-Auffüllung
  // brachte jede Region auf (mindestens) 32 Teams, aber der Vorrunde-Cut in
  // resolveOpenEvent() (>32 Orgas -> Cut auf 32) griff dadurch nirgends außer
  // in NA (38 Orgas). Die 218 Orgas unten sind wie schon in Runde 45 KOMPLETT
  // FIKTIV (gleiche Namens-Kombinatorik, deterministisch per Seed generiert,
  // siehe scratchpad-Skript generate_orgs.js dieser Runde), erweitert um neue
  // Präfixe/Suffixe für mehr Namensvielfalt bei dieser Menge. Jede Region
  // landet dadurch bei genau 64 Teams (EU 32->64, NA 38->64, MENA 32->64,
  // SAM 32->64, OCE 32->64, APAC 32->64, SSA 32->64). Pro Region sind 2-3
  // dieser neuen Orgas zusätzlich in BIG_ORG_NAMES (org-rosters.js)
  // eingetragen, damit auch unter den NEUEN Orgas jede Region 4,5-5-Sterne-
  // Top-Teams bekommt (sonst wären alle 218 neuen Orgas nur 0,5-4 Sterne,
  // da BIG_ORG_NAMES bisher nur die 18 echten Top-Orgas enthielt). Kein
  // `logo`-Feld (Buchstaben-Platzhalter wie bei den Runde-45-Orgas).
  { name: 'Luminous Brigade', country: 'IT', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // EU
  { name: 'Krypton Wave', country: 'IE', description: 'Eine der einflussreichsten Marken ihrer Region -- große Fanbase, große Erwartungen, große Ergebnisse.' }, // EU
  { name: 'Raptor Pack', country: 'DE', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // EU
  { name: 'Solstice Titans', country: 'ES', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // EU
  { name: 'Onyx Circuit', country: 'SE', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Nimbus Club', country: 'DK', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // EU
  { name: 'Ashen Bastion', country: 'NO', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Grim Esports', country: 'DE', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // EU
  { name: 'Lunar Guild', country: 'DE', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // EU
  { name: 'Fusion Crew', country: 'BE', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // EU
  { name: 'Umbra Hawks', country: 'FR', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // EU
  { name: 'Cyclone Nation', country: 'IT', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // EU
  { name: 'Draco Academy', country: 'FI', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Nimbus Brigade', country: 'NL', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // EU
  { name: 'Cyclone Wave', country: 'AT', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // EU
  { name: 'Ember Bastion', country: 'AT', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // EU
  { name: 'Raptor Crew', country: 'GB', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // EU
  { name: 'Luminous Legion', country: 'DE', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // EU
  { name: 'Rift Pack', country: 'BE', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // EU
  { name: 'Solstice Crew', country: 'DK', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // EU
  { name: 'Cinder Wave', country: 'DK', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Basilisk Wolves', country: 'NL', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Kaon Academy', country: 'GB', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // EU
  { name: 'Draco Pack', country: 'BE', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // EU
  { name: 'Rift Core', country: 'DE', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Volt Front', country: 'IE', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // EU
  { name: 'Glacier Alliance', country: 'FI', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // EU
  { name: 'Specter Bastion', country: 'GB', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // EU
  { name: 'Cobra Alliance', country: 'FI', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // EU
  { name: 'Basilisk United', country: 'FR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // EU
  { name: 'Blaze Guild', country: 'CH', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // EU
  { name: 'Onyx Guild', country: 'CH', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // EU
  { name: 'Ashen Force', country: 'MX', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // NA
  { name: 'Orbit Force', country: 'US', description: 'Etablierte Top-Organisation mit großem Kader-Budget und entsprechend hohen Ansprüchen an jede Saison.' }, // NA
  { name: 'Dusk Esports', country: 'MX', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // NA
  { name: 'Fusion Esports', country: 'CA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // NA
  { name: 'Frost Federation', country: 'CA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // NA
  { name: 'Fusion Titans', country: 'US', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // NA
  { name: 'Blaze United', country: 'MX', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // NA
  { name: 'Catalyst Reign', country: 'CA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // NA
  { name: 'Hydra Titans', country: 'US', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // NA
  { name: 'Obsidian Reign', country: 'CA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // NA
  { name: 'Ember Collective', country: 'MX', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // NA
  { name: 'Basilisk Reign', country: 'CA', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // NA
  { name: 'Falcon Rising', country: 'CA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // NA
  { name: 'Tempest Order', country: 'MX', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // NA
  { name: 'Crimson Pack', country: 'CA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // NA
  { name: 'Shadow Rebels', country: 'CA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // NA
  { name: 'Neon Crew', country: 'US', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // NA
  { name: 'Astra Rising', country: 'CA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // NA
  { name: 'Nightfall Enclave', country: 'MX', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // NA
  { name: 'Aether Collective', country: 'MX', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // NA
  { name: 'Wraith Rising', country: 'CA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // NA
  { name: 'Quantum Circuit', country: 'US', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // NA
  { name: 'Orbit Enclave', country: 'US', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // NA
  { name: 'Titan Force', country: 'CA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // NA
  { name: 'Raptor Bastion', country: 'CA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // NA
  { name: 'Helix Front', country: 'CA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // NA
  { name: 'Comet Dynasty', country: 'BR', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // SAM
  { name: 'Pulse Collective', country: 'AR', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // SAM
  { name: 'Basilisk Enclave', country: 'CL', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // SAM
  { name: 'Quantum Core', country: 'CL', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Titan Company', country: 'AR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Pyre Force', country: 'CL', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SAM
  { name: 'Jolt Guild', country: 'CL', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Radiant Order', country: 'BR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Comet Collective', country: 'AR', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // SAM
  { name: 'Apex Rebels', country: 'BR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SAM
  { name: 'Kaon Wolves', country: 'AR', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Solar Esports', country: 'CL', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Radiant United', country: 'CL', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Comet Federation', country: 'CL', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Helix Enclave', country: 'CL', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SAM
  { name: 'Zephyr Legion', country: 'AR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Luminous Alliance', country: 'AR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Aether Vanguard', country: 'BR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Rift Front', country: 'AR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SAM
  { name: 'Aether Order', country: 'BR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Specter Federation', country: 'CL', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SAM
  { name: 'Cobra Academy', country: 'BR', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SAM
  { name: 'Ember Pack', country: 'CL', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // SAM
  { name: 'Volt Gaming', country: 'BR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SAM
  { name: 'Shadow Collective', country: 'AR', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Meteor Legion', country: 'AR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Catalyst Squad', country: 'CL', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Ignite Order', country: 'CL', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Tempest Enclave', country: 'AR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SAM
  { name: 'Obsidian Order', country: 'CL', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SAM
  { name: 'Luminous Dynasty', country: 'CL', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SAM
  { name: 'Fusion Outfit', country: 'AR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SAM
  { name: 'Cyclone Syndicate', country: 'SA', description: 'Etablierte Top-Organisation mit großem Kader-Budget und entsprechend hohen Ansprüchen an jede Saison.' }, // MENA
  { name: 'Falcon Outfit', country: 'OM', description: 'Eine der einflussreichsten Marken ihrer Region -- große Fanbase, große Erwartungen, große Ergebnisse.' }, // MENA
  { name: 'Pyre Company', country: 'MA', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // MENA
  { name: 'Draco Bastion', country: 'OM', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // MENA
  { name: 'Basilisk Rising', country: 'SA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // MENA
  { name: 'Frost Circuit', country: 'EG', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Ember Esports', country: 'OM', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // MENA
  { name: 'Ashfall Front', country: 'SA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // MENA
  { name: 'Meteor Esports', country: 'OM', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // MENA
  { name: 'Blaze Squad', country: 'MA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // MENA
  { name: 'Quantum Force', country: 'MA', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Vortex Company', country: 'SA', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // MENA
  { name: 'Ashen Enclave', country: 'EG', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Frost Front', country: 'EG', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Tempest Nation', country: 'MA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Onyx Core', country: 'MA', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // MENA
  { name: 'Frost Wave', country: 'EG', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Phantom Alliance', country: 'EG', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // MENA
  { name: 'Grim Core', country: 'MA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Magma Esports', country: 'SA', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // MENA
  { name: 'Specter Outfit', country: 'SA', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // MENA
  { name: 'Nebula Bastion', country: 'MA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // MENA
  { name: 'Cyclone Collective', country: 'MA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Basilisk Brigade', country: 'MA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Zenith Rebels', country: 'OM', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Lunar Circuit', country: 'OM', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Orbit Order', country: 'MA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Onyx Wave', country: 'OM', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Falcon Alliance', country: 'MA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // MENA
  { name: 'Radiant Core', country: 'MA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Specter Enclave', country: 'SA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // MENA
  { name: 'Granite Gaming', country: 'SA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // MENA
  { name: 'Nebula Dynasty', country: 'AU', description: 'Etablierte Top-Organisation mit großem Kader-Budget und entsprechend hohen Ansprüchen an jede Saison.' }, // OCE
  { name: 'Ferox Syndicate', country: 'AU', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // OCE
  { name: 'Quake Rebels', country: 'NZ', description: 'Finanzstarke, professionell geführte Organisation, die sich in kurzer Zeit an die Spitze ihrer Region gespielt hat.' }, // OCE
  { name: 'Umbra Crew', country: 'AU', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // OCE
  { name: 'Lunar Esports', country: 'NZ', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // OCE
  { name: 'Prime Hawks', country: 'AU', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Omega Hawks', country: 'AU', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // OCE
  { name: 'Aether Crew', country: 'NZ', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Cyclone Academy', country: 'AU', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Prism Club', country: 'NZ', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Eclipse Rising', country: 'NZ', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // OCE
  { name: 'Ferox Front', country: 'AU', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // OCE
  { name: 'Onyx Company', country: 'AU', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Orbit Federation', country: 'NZ', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Draco Titans', country: 'NZ', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Cyclone Squad', country: 'NZ', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // OCE
  { name: 'Storm Front', country: 'AU', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Quake United', country: 'NZ', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // OCE
  { name: 'Pyre Legion', country: 'AU', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Orbit Club', country: 'NZ', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Dusk Force', country: 'AU', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Eclipse Vanguard', country: 'AU', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // OCE
  { name: 'Riptide Gaming', country: 'AU', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Neon Syndicate', country: 'NZ', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // OCE
  { name: 'Cinder Federation', country: 'NZ', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Prime Front', country: 'AU', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // OCE
  { name: 'Prime Alliance', country: 'AU', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // OCE
  { name: 'Solstice Federation', country: 'AU', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // OCE
  { name: 'Ion Nation', country: 'NZ', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // OCE
  { name: 'Basilisk Rebels', country: 'AU', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // OCE
  { name: 'Wyvern Crew', country: 'NZ', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // OCE
  { name: 'Grim Company', country: 'NZ', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // OCE
  { name: 'Neon Enclave', country: 'KR', description: 'Eine der einflussreichsten Marken ihrer Region -- große Fanbase, große Erwartungen, große Ergebnisse.' }, // APAC
  { name: 'Glacier Guild', country: 'JP', description: 'Etablierte Top-Organisation mit großem Kader-Budget und entsprechend hohen Ansprüchen an jede Saison.' }, // APAC
  { name: 'Comet Company', country: 'KR', description: 'Eine der einflussreichsten Marken ihrer Region -- große Fanbase, große Erwartungen, große Ergebnisse.' }, // APAC
  { name: 'Blaze Titans', country: 'JP', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // APAC
  { name: 'Crimson Outfit', country: 'KR', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Prime Rising', country: 'JP', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Nova Bastion', country: 'KR', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // APAC
  { name: 'Quake Rising', country: 'KR', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // APAC
  { name: 'Crimson Titans', country: 'JP', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // APAC
  { name: 'Ion Enclave', country: 'KR', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Shadow Circuit', country: 'KR', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // APAC
  { name: 'Catalyst Federation', country: 'JP', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Orbit Vanguard', country: 'JP', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // APAC
  { name: 'Onyx Squad', country: 'JP', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Echo Wolves', country: 'KR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Raptor Hawks', country: 'KR', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Glacier Esports', country: 'JP', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Ignite Club', country: 'KR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Blaze Collective', country: 'KR', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // APAC
  { name: 'Crimson Legion', country: 'KR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Onyx Dynasty', country: 'KR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Omega Dynasty', country: 'JP', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Orbit Rebels', country: 'KR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // APAC
  { name: 'Umbra Pack', country: 'KR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // APAC
  { name: 'Nebula Vanguard', country: 'JP', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // APAC
  { name: 'Crimson Hawks', country: 'KR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Kinetic Collective', country: 'KR', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // APAC
  { name: 'Tempest Crew', country: 'KR', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // APAC
  { name: 'Kinetic Company', country: 'KR', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // APAC
  { name: 'Dusk Vanguard', country: 'KR', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // APAC
  { name: 'Specter Wave', country: 'KR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Ignite Syndicate', country: 'KR', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // APAC
  { name: 'Surge Titans', country: 'ZA', description: 'Eine der einflussreichsten Marken ihrer Region -- große Fanbase, große Erwartungen, große Ergebnisse.' }, // SSA
  { name: 'Crimson United', country: 'ZA', description: 'Eine der einflussreichsten Marken ihrer Region -- große Fanbase, große Erwartungen, große Ergebnisse.' }, // SSA
  { name: 'Talon Guild', country: 'ZA', description: 'Eine der einflussreichsten Marken ihrer Region -- große Fanbase, große Erwartungen, große Ergebnisse.' }, // SSA
  { name: 'Blaze Rising', country: 'ZA', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SSA
  { name: 'Falcon Front', country: 'ZA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SSA
  { name: 'Glacier Front', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Zephyr Wolves', country: 'ZA', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SSA
  { name: 'Lunar Academy', country: 'ZA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SSA
  { name: 'Vertex Order', country: 'ZA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SSA
  { name: 'Lunar United', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Nebula Force', country: 'ZA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SSA
  { name: 'Lunar Pack', country: 'ZA', description: 'Organisation mit selbstbewusstem Markenauftritt, die sich vor allem über harte Arbeit und Teamgeist definiert.' }, // SSA
  { name: 'Halo Core', country: 'ZA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // SSA
  { name: 'Omega Nation', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Catalyst Titans', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Krypton Syndicate', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Riptide Academy', country: 'ZA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SSA
  { name: 'Solstice Alliance', country: 'ZA', description: 'Community-getriebene Organisation mit direktem Draht zu ihren Fans und lockerer, unterhaltungsorientierter Kultur.' }, // SSA
  { name: 'Cinder Rebels', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Echo Outfit', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Solstice Company', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Riptide Brigade', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Specter Dynasty', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Nebula Rising', country: 'ZA', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SSA
  { name: 'Helix Bastion', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Echo Squad', country: 'ZA', description: 'Verhältnismäßig neue Organisation, die sich mit cleverem Roster-Aufbau langsam einen Namen macht.' }, // SSA
  { name: 'Nebula Rebels', country: 'ZA', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SSA
  { name: 'Ashen United', country: 'ZA', description: 'Junge Organisation, die bewusst auf Nachwuchstalente statt große Namen setzt und Schritt für Schritt wächst.' }, // SSA
  { name: 'Viper Kings', country: 'ZA', description: 'Solide aufgestellte Organisation mit bodenständiger Mentalität und stetigem, unaufgeregtem Wettkampfaufbau.' }, // SSA
  { name: 'Shadow Crew', country: 'ZA', description: 'Kleinere, aber ambitionierte Organisation mit treuer Fanbase und dem klaren Ziel, sich international zu etablieren.' }, // SSA
  { name: 'Equinox Vanguard', country: 'ZA', description: 'Regionale Organisation mit wachsendem Einfluss und großen Ambitionen für die kommenden Saisons.' }, // SSA
  { name: 'Eclipse Force', country: 'ZA', description: 'Aufstrebende Organisation, die sich seit ihrer Gründung konsequent im Rocket-League-Wettkampf hochgearbeitet hat.' }, // SSA
];

// Region pro Land-Code, aus der Nationalität der Org abgeleitet (Runde 44:
// "System soll automatisch alle Orgas deren Nationalität in 7 Regionen
// aufteilt"). Deckt sowohl alle Land-Codes ab, die unter den 87 festen Orgas
// tatsächlich vorkommen, als auch ALLE Codes aus CHARACTER_NATIONS (data/
// character-traits.js) -- letzteres ist nötig, weil selbst erstellte Orgas
// (buildCustomOrgFromForm()) ihr `country`-Feld aus genau dieser Liste
// wählen, dort aber mehr Länder zur Auswahl stehen als bei den festen Orgas
// tatsächlich verwendet werden (z.B. ES/BE/NO/DK/PL/FI/AT/CH/MX/CL/MA/EG/
// NZ/KR/ZA kommen bei keiner der 87 Orgas vor, sollen aber trotzdem ein
// gültiges Region-Ergebnis liefern). 7. Region SSA (Subsahara-Afrika) neu
// dazugekommen -- aktuell nur über ZA erreichbar, da Südafrika die einzige
// subsahara-afrikanische Nation in CHARACTER_NATIONS ist.
const ORG_COUNTRY_REGION = {
  // EU (Europa)
  FR: 'EU', SE: 'EU', GB: 'EU', IT: 'EU', DE: 'EU', NL: 'EU', IE: 'EU', PT: 'EU', TR: 'EU', AM: 'EU',
  ES: 'EU', BE: 'EU', NO: 'EU', DK: 'EU', PL: 'EU', FI: 'EU', AT: 'EU', CH: 'EU',
  // NA (Nordamerika)
  US: 'NA', CA: 'NA', PR: 'NA', MX: 'NA',
  // SAM (Südamerika)
  BR: 'SAM', AR: 'SAM', CL: 'SAM',
  // MENA (Naher Osten & Nordafrika)
  SA: 'MENA', OM: 'MENA', MA: 'MENA', EG: 'MENA',
  // OCE (Ozeanien)
  AU: 'OCE', NZ: 'OCE',
  // APAC (Asien-Pazifik)
  JP: 'APAC', KR: 'APAC',
  // SSA (Subsahara-Afrika)
  ZA: 'SSA',
};

function orgRegion(country) {
  return country ? (ORG_COUNTRY_REGION[country] || null) : null;
}

// Schwierigkeit als grobe 3-Stufen-Einteilung aus der Stärke abgeleitet --
// eine bereits starke Org (großes Budget, wenig Aufbauarbeit nötig) gilt als
// "leicht" zu übernehmen, eine schwache Org als "schwer" (Underdog-Aufbau von
// wenig Budget aus) — konsistent mit dem bestehenden Org-Auswahl-Flavourtext
// ("Underdog, bei dem jede Überraschung doppelt zählt").
function orgDifficulty(strength) {
  if (strength >= 80) return { label: 'LEICHT', level: 'easy' };
  if (strength >= 65) return { label: 'MITTEL', level: 'medium' };
  return { label: 'SCHWER', level: 'hard' };
}

// 5-Sterne-Darstellung (in 0.5er-Schritten) aus der 0-100-Stärke.
function orgStarRating(strength) {
  return Math.max(0.5, Math.min(5, Math.round((strength / 100) * 5 * 2) / 2));
}

// `strength` ist ab hier KEIN autoriertes Feld mehr, sondern wird aus dem
// generierten Kader berechnet (siehe computeOrgStrengthFromRoster() in
// org-rosters.js) -- User-Korrektur: "die orga soll anhand der spieler und
// dem staff der stärke zugeordnet sein" (nicht die Org bestimmt die Spieler-
// Sterne, sondern umgekehrt). Konkret (siehe org-rosters.js): jede Org bekommt
// zuerst selbst eine gleichmäßig verteilte Ziel-Qualitätsstufe (0,5-5), ihr
// Kader streut dann um DIESE Stufe -- so kann eine Org wie im Nutzerbeispiel
// tatsächlich 5 Sterne (fast durchgängig starke Spieler/Mitarbeiter) oder 1
// Stern (fast durchgängig schwache) erreichen, statt sich (bei komplett
// unabhängiger Personen-Ziehung) statistisch immer nur um die Mitte einzupendeln.
const ORGANIZATIONS = ORGANIZATIONS_RAW.map((org) => {
  const roster = generateOrgRoster(org);
  const strength = computeOrgStrengthFromRoster(roster);
  return {
    ...org,
    strength,
    roster,
    budget: computeOrgBudget(roster),
    matchBonusPct: computeMatchBonusPct(strength),
  };
});

function findOrgByName(name) {
  return ORGANIZATIONS.find((o) => o.name === name) || null;
}

// Baut eine konkrete Org-Instanz für die Auswahlmenü-Vorschau UND die finale
// Bestätigung -- reines Kopieren, seit `description` (anders als früher
// pro/con) ein fester, nicht zufällig gewählter Wert pro Org ist.
function instantiateOrg(org) {
  return { ...org };
}

// Nicht mehr im Karriere-Modus verwendet (User-Wunsch: Auswahlmenü statt
// Zufalls-Slotmachine) — bleibt für den späteren Randomizer-Challenge-Modus
// erhalten, der genau diese Zufallszuweisung nutzen soll.
function assignRandomOrg() {
  const org = ORGANIZATIONS[Math.floor(Math.random() * ORGANIZATIONS.length)];
  return instantiateOrg(org);
}
