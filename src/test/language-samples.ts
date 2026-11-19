// Pages of the length of a short wiki page in the languages that search tells apart, all with the same content: how
// the backups of a database server work. The tests of the language of a page (`src/features/search/language.test.ts`)
// and of search use them. No test itself.

/** The sentences of each sample; the first one is the title of its page. */
const SENTENCES = {
  basque: `Datu-basearen zerbitzariaren babeskopiak. Gauero ordu bietan, zerbitzariak datu-basearen babeskopia oso bat
    idazten du bigarren datu-zentroko biltegian. Babeskopiak hogeita hamar egunez gordetzen dira, eta zaharrenak
    automatikoki ezabatzen dira. Babeskopia bat leheneratu aurretik, gelditu aplikazioa eta jakinarazi taldeko beste
    kideei. Leheneratu ondoren, egiaztatu erabiltzaileek saioa has dezaketela eta orrialde berrienak hor daudela.
    Zerbait gaizki ateratzen bada, idatzi zer egin duzun eta eskatu laguntza guardiako pertsonari.`,
  catalan: `Còpies de seguretat del servidor de bases de dades. Cada nit a les dues, el servidor escriu una còpia de
    seguretat completa de la base de dades a l'emmagatzematge del segon centre de dades. Les còpies es guarden durant
    trenta dies i les més antigues s'esborren automàticament. Abans de restaurar una còpia, atura l'aplicació i avisa
    els altres membres de l'equip. Després de la restauració, comprova que els usuaris poden iniciar la sessió i que
    les pàgines més noves hi són. Si alguna cosa va malament, apunta què has fet i demana ajuda a la persona de
    guàrdia.`,
  danish: `Sikkerhedskopier af databaseserveren. Hver nat klokken to skriver serveren en fuld sikkerhedskopi af
    databasen til lageret i det andet datacenter. Sikkerhedskopierne gemmes i tredive dage, og de ældste bliver slettet
    automatisk. Før du gendanner en sikkerhedskopi, skal du stoppe programmet og give de andre i holdet besked. Efter
    gendannelsen skal du kontrollere, at brugerne kan logge ind, og at de nyeste sider er der. Hvis noget går galt, så
    skriv ned, hvad du har gjort, og bed den person, der har vagten, om hjælp.`,
  dutch: `Back-ups van de databaseserver. Elke nacht om twee uur schrijft de server een volledige back-up van de
    database naar de opslag in het tweede datacenter. De back-ups worden dertig dagen bewaard en de oudste worden
    automatisch verwijderd. Voordat je een back-up terugzet, stop je de applicatie en laat je het de andere leden van
    het team weten. Controleer na het terugzetten of de gebruikers kunnen inloggen en of de nieuwste pagina's er zijn.
    Als er iets misgaat, schrijf dan op wat je hebt gedaan en vraag de collega van de wachtdienst om hulp.`,
  english: `Backups of the database server. Every night at two o'clock the server writes a full backup of the database
    to the storage in the second data centre. The backups are kept for thirty days, and the oldest ones are deleted
    automatically. Before you restore a backup, stop the application and tell the other members of the team. After the
    restore, check that the users can log in and that the latest pages are there. If something goes wrong, write down
    what you did and ask the person on call for help.`,
  estonian: `Andmebaasiserveri varukoopiad. Igal ööl kell kaks kirjutab server andmebaasist täieliku varukoopia teise
    andmekeskuse salvestusruumi. Varukoopiaid hoitakse kolmkümmend päeva ja kõige vanemad kustutatakse automaatselt.
    Enne varukoopia taastamist peata rakendus ja anna teistele meeskonnaliikmetele teada. Pärast taastamist kontrolli,
    et kasutajad saavad sisse logida ja et uusimad lehed on olemas. Kui midagi läheb valesti, kirjuta üles, mida sa
    tegid, ja palu valves olevalt inimeselt abi.`,
  finnish: `Tietokantapalvelimen varmuuskopiot. Joka yö kello kaksi palvelin kirjoittaa tietokannasta täydellisen
    varmuuskopion toisen konesalin tallennustilaan. Varmuuskopioita säilytetään kolmekymmentä päivää, ja vanhimmat
    poistetaan automaattisesti. Ennen kuin palautat varmuuskopion, pysäytä sovellus ja kerro siitä muille tiimin
    jäsenille. Tarkista palautuksen jälkeen, että käyttäjät voivat kirjautua sisään ja että uusimmat sivut ovat
    tallessa. Jos jokin menee pieleen, kirjoita muistiin, mitä teit, ja pyydä apua päivystäjältä.`,
  french: `Sauvegardes du serveur de base de données. Chaque nuit à deux heures, le serveur écrit une sauvegarde
    complète de la base de données sur le stockage du deuxième centre de données. Les sauvegardes sont conservées
    pendant trente jours, et les plus anciennes sont supprimées automatiquement. Avant de restaurer une sauvegarde,
    arrêtez l'application et prévenez les autres membres de l'équipe. Après la restauration, vérifiez que les
    utilisateurs peuvent se connecter et que les pages les plus récentes sont présentes. Si quelque chose se passe mal,
    notez ce que vous avez fait et demandez de l'aide à la personne d'astreinte.`,
  german: `Sicherung des Datenbankservers. Jede Nacht um zwei Uhr schreibt der Server eine vollständige Sicherung der
    Datenbank in den Speicher des zweiten Rechenzentrums. Die Sicherungen werden dreißig Tage lang aufbewahrt, und die
    ältesten werden automatisch gelöscht. Bevor du eine Sicherung zurückspielst, halte die Anwendung an und sag den
    anderen im Team Bescheid. Prüfe nach der Wiederherstellung, ob sich die Benutzer anmelden können und ob die
    neuesten Seiten da sind. Wenn etwas schiefgeht, schreib auf, was du getan hast, und bitte die Bereitschaft um
    Hilfe.`,
  greek: `Αντίγραφα ασφαλείας του διακομιστή της βάσης δεδομένων. Κάθε βράδυ στις δύο η ώρα ο διακομιστής γράφει ένα
    πλήρες αντίγραφο ασφαλείας της βάσης δεδομένων στον αποθηκευτικό χώρο του δεύτερου κέντρου δεδομένων. Τα αντίγραφα
    φυλάσσονται για τριάντα ημέρες και τα παλαιότερα διαγράφονται αυτόματα. Πριν επαναφέρεις ένα αντίγραφο, σταμάτησε
    την εφαρμογή και ενημέρωσε τα άλλα μέλη της ομάδας. Μετά την επαναφορά, έλεγξε ότι οι χρήστες μπορούν να
    συνδεθούν και ότι οι πιο πρόσφατες σελίδες υπάρχουν. Αν κάτι πάει στραβά, σημείωσε τι έκανες και ζήτησε βοήθεια
    από τον εφημερεύοντα.`,
  hungarian: `Az adatbázis-kiszolgáló biztonsági mentései. A kiszolgáló minden éjjel kettőkor teljes biztonsági mentést
    ír az adatbázisról a második adatközpont tárolójára. A mentéseket harminc napig őrizzük meg, a legrégebbieket pedig
    automatikusan töröljük. Mielőtt visszaállítasz egy mentést, állítsd le az alkalmazást, és szólj a csapat többi
    tagjának. A visszaállítás után ellenőrizd, hogy a felhasználók be tudnak-e jelentkezni, és hogy megvannak-e a
    legújabb oldalak. Ha valami rosszul sül el, írd le, mit csináltál, és kérj segítséget az ügyeletestől.`,
  italian: `Backup del server del database. Ogni notte alle due il server scrive un backup completo del database sullo
    spazio di archiviazione del secondo centro dati. I backup vengono conservati per trenta giorni e i più vecchi
    vengono cancellati automaticamente. Prima di ripristinare un backup, ferma l'applicazione e avvisa gli altri membri
    del gruppo. Dopo il ripristino, controlla che gli utenti possano accedere e che le pagine più recenti ci siano. Se
    qualcosa va storto, annota quello che hai fatto e chiedi aiuto alla persona di turno.`,
  lithuanian: `Duomenų bazės serverio atsarginės kopijos. Kiekvieną naktį antrą valandą serveris įrašo visą duomenų
    bazės atsarginę kopiją į antrojo duomenų centro saugyklą. Atsarginės kopijos saugomos trisdešimt dienų, o
    seniausios ištrinamos automatiškai. Prieš atkurdamas atsarginę kopiją, sustabdyk programą ir pranešk kitiems
    komandos nariams. Po atkūrimo patikrink, ar naudotojai gali prisijungti ir ar naujausi puslapiai yra vietoje. Jei
    kas nors nepavyksta, užsirašyk, ką padarei, ir paprašyk budinčio žmogaus pagalbos.`,
  norwegian: `Sikkerhetskopier av databaseserveren. Hver natt klokka to skriver serveren en fullstendig sikkerhetskopi
    av databasen til lagringen i det andre datasenteret. Sikkerhetskopiene blir tatt vare på i tretti dager, og de
    eldste blir slettet automatisk. Før du gjenoppretter en sikkerhetskopi, må du stoppe programmet og si fra til de
    andre på laget. Etter gjenopprettingen må du sjekke at brukerne kan logge inn, og at de nyeste sidene er der. Hvis
    noe går galt, skriv ned hva du har gjort, og be den som har vakt, om hjelp.`,
  portuguese: `Cópias de segurança do servidor de base de dados. Todas as noites às duas horas, o servidor grava uma
    cópia de segurança completa da base de dados no armazenamento do segundo centro de dados. As cópias são guardadas
    durante trinta dias e as mais antigas são apagadas automaticamente. Antes de restaurar uma cópia, pare a aplicação
    e avise os outros membros da equipa. Depois da restauração, verifique se os utilizadores conseguem iniciar sessão
    e se as páginas mais recentes estão lá. Se alguma coisa correr mal, anote o que fez e peça ajuda à pessoa de
    prevenção.`,
  romanian: `Copiile de rezervă ale serverului de baze de date. În fiecare noapte la ora două, serverul scrie o copie
    de rezervă completă a bazei de date pe spațiul de stocare din al doilea centru de date. Copiile sunt păstrate timp
    de treizeci de zile, iar cele mai vechi sunt șterse automat. Înainte de a restaura o copie, oprește aplicația și
    anunță ceilalți membri ai echipei. După restaurare, verifică dacă utilizatorii se pot autentifica și dacă paginile
    cele mai noi sunt acolo. Dacă ceva nu merge bine, notează ce ai făcut și cere ajutor persoanei de gardă.`,
  russian: `Резервные копии сервера базы данных. Каждую ночь в два часа сервер записывает полную резервную копию базы
    данных в хранилище второго центра обработки данных. Копии хранятся тридцать дней, а самые старые удаляются
    автоматически. Перед восстановлением копии остановите приложение и предупредите других членов команды. После
    восстановления проверьте, что пользователи могут войти в систему и что самые новые страницы на месте. Если что-то
    пошло не так, запишите, что вы сделали, и попросите помощи у дежурного.`,
  serbian: `Резервне копије сервера базе података. Сваке ноћи у два сата сервер уписује пуну резервну копију базе
    података у складиште другог центра података. Копије се чувају тридесет дана, а најстарије се аутоматски бришу. Пре
    него што вратиш копију, заустави апликацију и обавести остале чланове тима. После враћања провери да ли корисници
    могу да се пријаве и да ли су најновије странице ту. Ако нешто пође наопако, запиши шта си урадио и затражи помоћ
    од дежурне особе.`,
  spanish: `Copias de seguridad del servidor de bases de datos. Cada noche a las dos, el servidor escribe una copia de
    seguridad completa de la base de datos en el almacenamiento del segundo centro de datos. Las copias se guardan
    durante treinta días y las más antiguas se borran automáticamente. Antes de restaurar una copia, detén la
    aplicación y avisa a los demás miembros del equipo. Después de la restauración, comprueba que los usuarios pueden
    iniciar sesión y que las páginas más recientes están ahí. Si algo sale mal, anota lo que hiciste y pide ayuda a la
    persona de guardia.`,
  swedish: `Säkerhetskopior av databasservern. Varje natt klockan två skriver servern en fullständig säkerhetskopia av
    databasen till lagringen i det andra datacentret. Säkerhetskopiorna sparas i trettio dagar, och de äldsta raderas
    automatiskt. Innan du återställer en säkerhetskopia ska du stoppa programmet och säga till de andra i teamet.
    Efter återställningen ska du kontrollera att användarna kan logga in och att de senaste sidorna finns där. Om
    något går fel, skriv ner vad du har gjort och be den som har jouren om hjälp.`,
  turkish: `Veritabanı sunucusunun yedekleri. Sunucu her gece saat ikide veritabanının tam bir yedeğini ikinci veri
    merkezindeki depolama alanına yazar. Yedekler otuz gün boyunca saklanır ve en eskileri otomatik olarak silinir. Bir
    yedeği geri yüklemeden önce uygulamayı durdur ve ekibin diğer üyelerine haber ver. Geri yüklemeden sonra
    kullanıcıların oturum açabildiğini ve en yeni sayfaların yerinde olduğunu kontrol et. Bir şeyler ters giderse ne
    yaptığını yaz ve nöbetçi kişiden yardım iste.`,
  // Languages that the database cannot stem, and Croatian, which is easy to take for Serbian.
  croatian: `Sigurnosne kopije poslužitelja baze podataka. Svake noći u dva sata poslužitelj zapisuje potpunu
    sigurnosnu kopiju baze podataka u spremište drugog podatkovnog centra. Kopije se čuvaju trideset dana, a
    najstarije se automatski brišu. Prije nego što vratiš kopiju, zaustavi aplikaciju i obavijesti ostale članove
    tima. Nakon vraćanja provjeri mogu li se korisnici prijaviti i jesu li najnovije stranice tu. Ako nešto pođe po
    zlu, zapiši što si učinio i zatraži pomoć od dežurne osobe.`,
  czech: `Zálohy databázového serveru. Každou noc ve dvě hodiny zapíše server úplnou zálohu databáze do úložiště v
    druhém datovém centru. Zálohy se uchovávají třicet dní a ty nejstarší se automaticky mažou. Než obnovíš zálohu,
    zastav aplikaci a dej vědět ostatním členům týmu. Po obnovení zkontroluj, že se uživatelé mohou přihlásit a že
    nejnovější stránky jsou na místě. Pokud se něco pokazí, zapiš si, co jsi udělal, a požádej o pomoc toho, kdo má
    pohotovost.`,
  irish: `Cúltacaí de fhreastalaí an bhunachair sonraí. Gach oíche ag a dó a chlog scríobhann an freastalaí cúltaca
    iomlán den bhunachar sonraí chuig an stóras sa dara lárionad sonraí. Coinnítear na cúltacaí ar feadh tríocha lá,
    agus scriostar na cinn is sine go huathoibríoch. Sula n-athchóiríonn tú cúltaca, stop an feidhmchlár agus cuir na
    baill eile den fhoireann ar an eolas. Tar éis an athchóirithe, seiceáil gur féidir leis na húsáideoirí logáil
    isteach agus go bhfuil na leathanaigh is nuaí ann. Má théann rud éigin mícheart, scríobh síos cad a rinne tú agus
    iarr cabhair ar an duine atá ar dualgas.`,
  polish: `Kopie zapasowe serwera bazy danych. Każdej nocy o drugiej serwer zapisuje pełną kopię zapasową bazy danych
    w magazynie drugiego centrum danych. Kopie są przechowywane przez trzydzieści dni, a najstarsze są usuwane
    automatycznie. Zanim przywrócisz kopię, zatrzymaj aplikację i powiadom pozostałych członków zespołu. Po
    przywróceniu sprawdź, czy użytkownicy mogą się zalogować i czy najnowsze strony są na miejscu. Jeśli coś pójdzie
    nie tak, zapisz, co zrobiłeś, i poproś o pomoc osobę dyżurną.`,
  ukrainian: `Резервні копії сервера бази даних. Щоночі о другій годині сервер записує повну резервну копію бази даних
    у сховище другого центру обробки даних. Копії зберігаються тридцять днів, а найстаріші видаляються автоматично.
    Перед відновленням копії зупиніть застосунок і попередьте інших членів команди. Після відновлення перевірте, що
    користувачі можуть увійти в систему і що найновіші сторінки на місці. Якщо щось пішло не так, запишіть, що ви
    зробили, і попросіть допомоги в чергового.`,
} as const;

/** The languages of the samples. */
export type SampleLanguage = keyof typeof SENTENCES;

/** The text of the sample without its line breaks. */
function flowed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The sample of the language as a page: its first sentence as the title heading, the others as a paragraph. */
export function samplePage(language: SampleLanguage): string {
  const text = flowed(SENTENCES[language]);
  const end = text.indexOf(". ");
  return `# ${text.slice(0, end)}\n\n${text.slice(end + 2)}\n`;
}
