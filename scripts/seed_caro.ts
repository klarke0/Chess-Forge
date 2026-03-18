import { PgnParser } from '../src/services/pgn_parser';
import { RepertoireBuilder } from '../src/services/repertoire_builder';

const PGN_PATH = 'src/data/caro_kann.pgn';
const API_URL = 'http://localhost:3001/api/repertoires/import';

async function seed() {
  console.log("Reading Caro-Kann PGN...");
  const pgn = await Bun.file(PGN_PATH).text();
  
  console.log("Parsing PGN...");
  const parsed = PgnParser.parse(pgn);
  console.log(`Found ${parsed.length} chapters.`);

  console.log("Building repertoire structure...");
  const importData = RepertoireBuilder.build(parsed, "Caro-Kann Repertoire");

  console.log("Uploading to backend...");
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(importData)
  });

  if (response.ok) {
    const result = await response.json();
    console.log("Success!", result);
  } else {
    const err = await response.text();
    console.error("Failed to import:", err);
  }
}

seed();
