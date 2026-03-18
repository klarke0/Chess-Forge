import { PgnParser } from '../src/services/pgn_parser';
import { RepertoireBuilder } from '../src/services/repertoire_builder';

const PGN_PATH = 'lichess_study_-kings-indian-fantastic-opening_by_FunnyAnimatorJimTV_2017.12.21.pgn';
const API_URL = 'http://localhost:3001/api/repertoires/import';

async function importKID() {
  console.log(`Reading PGN: ${PGN_PATH}...`);
  const pgn = await Bun.file(PGN_PATH).text();
  
  console.log("Parsing PGN...");
  const parsed = PgnParser.parse(pgn);
  console.log(`Found ${parsed.length} chapters.`);

  console.log("Building repertoire structure...");
  const importData = RepertoireBuilder.build(parsed, "King's Indian Defense");

  console.log("Uploading to backend...");
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...importData,
      side: 'black' // Explicitly set as a Black repertoire
    })
  });

  if (response.ok) {
    const result = await response.json();
    console.log("Success! Imported Repertoire:", result);
  } else {
    const err = await response.text();
    console.error("Failed to import:", err);
  }
}

importKID();