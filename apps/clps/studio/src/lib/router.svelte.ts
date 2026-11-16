export type Mode = 'home' | 'plan' | 'compare' | 'surface' | 'landings';

interface Route {
  mode: Mode;
  /** Real Landings only: the landing named after the mode, as in #/landings/apollo-11. */
  landingId: string | null;
}

function parse(hash: string): Route {
  const [head = '', second] = hash.replace(/^#\/?/, '').replace(/\?.*$/, '').split('/');
  if (head === 'surface') return { mode: 'surface', landingId: null };
  if (head === 'compare') return { mode: 'compare', landingId: null };
  if (head === 'landings') return { mode: 'landings', landingId: second ? decodeURIComponent(second) : null };
  return { mode: head === '' || head === 'home' ? 'home' : 'plan', landingId: null };
}

export const route = $state<Route>(parse(window.location.hash));

window.addEventListener('hashchange', () => {
  Object.assign(route, parse(window.location.hash));
});
