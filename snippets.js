const PLATFORMS = ['Windows', 'Linux', 'macOS', 'Uniwersalne'];
function validateSnippet(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Nieprawidłowy wpis.'), {status:400});
  const result = {};
  for (const [key,max,required] of [['title',120,true],['description',2000,false],['platform',30,true],['shell',50,true],['category',80,true],['tags',200,false],['command',20000,true]]) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw Object.assign(new Error(`Nieprawidłowe pole: ${key} (limit ${max} znaków).`),{status:400});
    // Preserve command whitespace and line endings exactly as entered/imported.
    result[key] = key === 'command' ? value : value.trim();
  }
  if (!PLATFORMS.includes(result.platform) || (input.favorite !== undefined && typeof input.favorite !== 'boolean')) throw Object.assign(new Error('Nieprawidłowy system lub oznaczenie ulubionego.'),{status:400});
  result.favorite = input.favorite ?? false;
  return result;
}
function snippetIdentity(value) {
  return JSON.stringify([value.platform.toLowerCase(),value.shell.toLowerCase(),value.command.replace(/\r\n?/g,'\n')]);
}
function createSnippetStore(database) {
  const existed = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='snippets'").get();
  database.exec(`CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, platform TEXT NOT NULL,
    shell TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL, command TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`);
  const map = row => row ? {...row,favorite:Boolean(row.favorite)} : undefined;
  const get = id => map(database.prepare('SELECT *, updated_at AS updatedAt FROM snippets WHERE id=?').get(id));
  const insert = database.prepare('INSERT INTO snippets(title,description,platform,shell,category,tags,command,favorite,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  function create(input) {
    const value = validateSnippet(input);
    const result = insert.run(value.title,value.description,value.platform,value.shell,value.category,value.tags,value.command,Number(value.favorite),new Date().toISOString());
    return get(Number(result.lastInsertRowid));
  }
  if (!existed) {
    database.exec('BEGIN');
    try {
      for(const entry of [
        ['Ping — 3 próby','Windows','CMD','ping -n 3 HOST','Zastąp HOST nazwą lub adresem urządzenia.'],
        ['Konfiguracja sieci','Windows','CMD','ipconfig /all','Wyświetla konfigurację interfejsów sieciowych.'],
        ['Sprawdzenie portu','Windows','PowerShell','Test-NetConnection -ComputerName HOST -Port 22','Zastąp HOST nazwą urządzenia, a port odpowiednią wartością.'],
        ['Połączenie SSH','Uniwersalne','SSH','ssh UZYTKOWNIK@HOST','Zastąp użytkownika i host przed samodzielnym uruchomieniem.'],
        ['Ping — 3 próby','Linux','Bash','ping -c 3 HOST','Zastąp HOST nazwą lub adresem urządzenia.'],
        ['Adresy interfejsów','Linux','Bash','ip address show','Wyświetla adresy interfejsów sieciowych.'],
      ]) create({title:entry[0],platform:entry[1],shell:entry[2],command:entry[3],description:entry[4],category:'Sieć',tags:'sieć, diagnostyka'});
      database.exec('COMMIT');
    } catch(error) {database.exec('ROLLBACK');throw error;}
  }
  return {
    list: () => database.prepare('SELECT *, updated_at AS updatedAt FROM snippets ORDER BY favorite DESC, title COLLATE NOCASE, id').all().map(map),
    create,
    update(id,input) {
      const value=validateSnippet(input);
      if(!get(id))throw Object.assign(new Error('Nie znaleziono wpisu.'),{status:404});
      database.prepare('UPDATE snippets SET title=?,description=?,platform=?,shell=?,category=?,tags=?,command=?,favorite=?,updated_at=? WHERE id=?')
        .run(value.title,value.description,value.platform,value.shell,value.category,value.tags,value.command,Number(value.favorite),new Date().toISOString(),id);
      return get(id);
    },
    favorite(id,value) {
      if(typeof value!=='boolean')throw Object.assign(new Error('Nieprawidłowe oznaczenie ulubionego.'),{status:400});
      if(!database.prepare('UPDATE snippets SET favorite=?,updated_at=? WHERE id=?').run(Number(value),new Date().toISOString(),id).changes)throw Object.assign(new Error('Nie znaleziono wpisu.'),{status:404});
      return get(id);
    },
    remove(id) {
      if(!database.prepare('DELETE FROM snippets WHERE id=?').run(id).changes)throw Object.assign(new Error('Nie znaleziono wpisu.'),{status:404});
    },
    import(input) {
      if(!input || input.version!==1 || !Array.isArray(input.snippets) || input.snippets.length>200)throw Object.assign(new Error('Wymagany plik JSON wersji 1, maksymalnie 200 wpisów.'),{status:400});
      const values=input.snippets.map(validateSnippet);
      const known = new Set(database.prepare('SELECT platform,shell,command FROM snippets').all().map(snippetIdentity));
      let imported=0,skipped=0;
      database.exec('BEGIN');
      try {
        for(const value of values) {
          const key=snippetIdentity(value);
          if(known.has(key)){skipped++;continue;}
          create(value);known.add(key);imported++;
        }
        database.exec('COMMIT');
      } catch(error){database.exec('ROLLBACK');throw error;}
      return {imported,skipped};
    },
  };
}
module.exports = {validateSnippet,createSnippetStore};
