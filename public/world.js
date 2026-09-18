export const MODEL = 'typesafe/jev';
export const COLORS = { jade: '#55b5a0', amber: '#e6a94c', violet: '#a69adc' };
export const BINS = [
  { id: 'jade', name: 'Jade', color: COLORS.jade, position: [0.48, 0, -0.28] },
  { id: 'amber', name: 'Amber', color: COLORS.amber, position: [0.48, 0, 0.02] },
  { id: 'violet', name: 'Violet', color: COLORS.violet, position: [0.48, 0, 0.32] },
  { id: 'inspection', name: 'Inspection', color: '#e78374', position: [-0.05, 0, 0.48] },
];
export const RECIPES = {
  quality: 'Sort every part into its matching color tray. Put damaged parts in the inspection tray instead. Finish when every part has been placed.',
  color: 'Sort every part into its matching color tray, regardless of damage. Finish when every part has been placed.',
  inspect: 'Move all parts to the inspection tray for a full quality audit.',
  violet: 'Move only the violet parts to the violet tray. Leave all other parts untouched, then finish.',
};
export function initialObjects() {
  return ['jade', 'amber', 'violet', 'violet', 'jade', 'amber'].map((color, i) => ({
    id: `P${String(i + 1).padStart(2, '0')}`, color, damaged: i === 4,
    status: 'pending', destination: null,
    position: [-0.51 + (i % 2) * 0.19, 0.045, -0.16 + Math.floor(i / 2) * 0.22],
  }));
}
export function destinationPosition(binId, slot) {
  const bin = BINS.find(b => b.id === binId);
  if (!bin || !Number.isInteger(slot) || slot < 0 || slot >= 6) throw new Error('Invalid tray slot');
  return [bin.position[0] + (slot % 3 - 1) * 0.067, 0.056, bin.position[2] + (Math.floor(slot / 3) - 0.5) * 0.088];
}
export function candidatesFor(objects, blockedBins = []) {
  return objects.filter(o => o.status === 'pending').flatMap(o => BINS.filter(b =>
    !blockedBins.includes(b.id) && objects.filter(p => p.destination === b.id).length < 6
  ).map(b => ({ id: `move_${o.id}_${b.id}`, objectId: o.id, destination: b.id,
    label: `${o.id} → ${b.name}`, description: `Pick ${o.id}, a ${o.color} part (${o.damaged ? 'DAMAGED' : 'undamaged'}), and place it in the ${b.name} tray.` })));
}
