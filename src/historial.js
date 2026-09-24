// Historial (para detectar cambios): la lista de partidos que la publicación automática guarda en
// el repositorio. Traducción de Save-Historial de calendario-voley.ps1.

import { DIAS_CORTOS, fmt } from './util.js';
import { formatHora } from './partidos.js';

export function crearHistorial(partidos, nombreClub, temporadaEtiqueta) {
  // Lista estable, sin fecha de generación: el archivo solo cambia cuando cambian los partidos.
  const lineas = [
    `# Partidos de ${nombreClub}, temporada ${temporadaEtiqueta} (Federación Galega de Voleibol)`,
    '# fecha | hora | categoría | local - visitante | pabellón | competición',
  ];
  for (const p of partidos) {
    const dia = `${DIAS_CORTOS[p.fecha.getUTCDay()]} ${fmt(p.fecha, 'yyyy-MM-dd')}`;
    lineas.push(`${dia} | ${formatHora(p)} | ${p.categoria} | ${p.local} - ${p.visitante} | ${p.pabellon} | ${p.competicion}`);
  }
  return `${lineas.join('\n')}\n`;
}
