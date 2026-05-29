import fs from 'fs';
import path from 'path';

const filePath = 'src/routes/porto-operacao.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Replace routes
content = content.replace(/\/usina-operacao/g, '/porto-operacao');
content = content.replace(/Usina —/g, 'Porto —');
content = content.replace(/UsinaSchedule/g, 'PortoSchedule');
content = content.replace(/UsinaOperacaoPage/g, 'PortoOperacaoPage');
content = content.replace(/Usina/g, 'Porto');
content = content.replace(/usina_/g, 'porto_');
content = content.replace(/usina/g, 'porto');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully renamed references in porto-operacao.tsx');
