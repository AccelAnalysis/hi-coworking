import { NASA_EXPO_EVENT } from "./expoNasaLead";

/** How long the booth loader may stay up if navigation never leaves this page. */
export const EXPO_OPEN_TIMEOUT_MS = 4000;

/**
 * Runs during HTML parse, before the Next.js bundle.
 * The booth page used to redirect from a React effect. If that bundle never
 * runs, the static "Opening Accel Analysis…" screen stays forever.
 * This script redirects immediately, and if the page is still here when the
 * timer fires, it reveals the form that was already in the document.
 */
export function expoAliasBootScript(): string {
  return `(function(){var EVENT=${JSON.stringify(NASA_EXPO_EVENT)};var TIMEOUT=${EXPO_OPEN_TIMEOUT_MS};function target(){var params=new URLSearchParams(location.search);if(!params.get("event")&&!params.get("event_id"))params.set("event",EVENT);var query=params.toString();return query?"/intake?"+query:"/intake";}function reveal(){var loader=document.getElementById("expo-opening");var form=document.getElementById("expo-form");if(!loader||!form)return;var path=String(location.pathname||"/");if(path.length>1&&path.charAt(path.length-1)==="/")path=path.slice(0,-1);if(path.indexOf("/expo/")!==0)return;try{var params=new URLSearchParams(location.search);if(!params.get("event")&&!params.get("event_id")){params.set("event",EVENT);history.replaceState(null,"",location.pathname+"?"+params.toString());}}catch(e){}loader.setAttribute("hidden","");form.removeAttribute("hidden");}try{location.replace(target());}catch(e){}setTimeout(reveal,TIMEOUT);})();`;
}
