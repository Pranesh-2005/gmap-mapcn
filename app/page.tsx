"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useId,
} from "react";
import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerLabel,
  MarkerTooltip,
  MarkerPopup,
  MapPopup,
  MapRoute,
  useMap,
  type MapRef,
  type MapViewport,
} from "@/components/ui/map";
import { Button } from "@/components/ui/button";
import {
  Navigation,
  MapPin,
  Search,
  X,
  Car,
  Bike,
  PersonStanding,
  RotateCcw,
  Layers,
  Clock,
  Route,
  ArrowUpDown,
  Loader2,
  CircleDot,
  Locate,
  Share2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  Maximize2,
  Moon,
  Sun,
  TriangleAlert,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Place {
  lng: number;
  lat: number;
  name: string;
  displayName: string;
}

interface RouteData {
  coordinates: [number, number][];
  distance: number;
  duration: number;
}

type TravelMode = "driving" | "walking" | "cycling";
type MapStyleKey = "default" | "bright" | "liberty";

interface UserLocation {
  lng: number;
  lat: number;
  accuracy: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function fmtTime(s: number) {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtSpeed(mps: number) {
  return `${Math.round(mps * 3.6)} km/h`;
}

async function geocode(query: string): Promise<Place | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    if (!data.length) return null;
    const r = data[0];
    return {
      lng: parseFloat(r.lon),
      lat: parseFloat(r.lat),
      name: r.display_name.split(",")[0],
      displayName: r.display_name,
    };
  } catch {
    return null;
  }
}

async function reverseGeocode(lng: number, lat: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    return data.display_name?.split(",").slice(0, 2).join(", ") ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

const OSRM_PROFILE: Record<TravelMode, string> = {
  driving: "driving",
  walking: "foot",
  cycling: "bike",
};

async function fetchRoute(from: Place, to: Place, mode: TravelMode): Promise<RouteData[]> {
  const profile = OSRM_PROFILE[mode];
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=true`
  );
  const data = await res.json();
  if (!data.routes?.length) return [];
  return data.routes.map((r: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }) => ({
    coordinates: r.geometry.coordinates,
    distance: r.distance,
    duration: r.duration,
  }));
}

// ─── Live location pulsing dot (via useMap hook) ──────────────────────────────
function LiveLocationLayer({ location }: { location: UserLocation | null }) {
  const { map, isLoaded } = useMap();
  const id = useId();
  const srcId = `loc-src-${id}`;
  const dotId = `loc-dot-${id}`;
  const pulseId = `loc-pulse-${id}`;
  const accId = `loc-acc-${id}`;

  useEffect(() => {
    if (!map || !isLoaded) return;

    // Add source
    map.addSource(srcId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // Accuracy circle
    map.addLayer({
      id: accId,
      type: "circle",
      source: srcId,
      paint: {
        "circle-radius": 40,
        "circle-color": "#3b82f6",
        "circle-opacity": 0.12,
        "circle-stroke-color": "#3b82f6",
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.3,
      },
    });

    // Outer pulse ring
    map.addLayer({
      id: pulseId,
      type: "circle",
      source: srcId,
      paint: {
        "circle-radius": 16,
        "circle-color": "#ffffff",
        "circle-opacity": 0.4,
      },
    });

    // Inner dot
    map.addLayer({
      id: dotId,
      type: "circle",
      source: srcId,
      paint: {
        "circle-radius": 8,
        "circle-color": "#3b82f6",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
        "circle-opacity": 1,
      },
    });

    return () => {
      try {
        [dotId, pulseId, accId].forEach((l) => { if (map.getLayer(l)) map.removeLayer(l); });
        if (map.getSource(srcId)) map.removeSource(srcId);
      } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded]);

  // Update position
  useEffect(() => {
    if (!map || !isLoaded) return;
    const src = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!location) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [location.lng, location.lat] },
      }],
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, location]);

  return null;
}

// ─── Map event child components ───────────────────────────────────────────────
function MapClickHandler({ onMapClick }: { onMapClick: (lng: number, lat: number) => void }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const handler = (e: { lngLat: { lng: number; lat: number } }) => onMapClick(e.lngLat.lng, e.lngLat.lat);
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [map, isLoaded, onMapClick]);
  return null;
}

function ViewportTracker({ onViewport }: { onViewport: (v: { zoom: number; lat: number; lng: number }) => void }) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const handler = () => {
      const c = map.getCenter();
      onViewport({ zoom: Math.round(map.getZoom() * 10) / 10, lat: c.lat, lng: c.lng });
    };
    map.on("move", handler);
    return () => { map.off("move", handler); };
  }, [map, isLoaded, onViewport]);
  return null;
}

// ─── MAP STYLE CONFIGS ────────────────────────────────────────────────────────
const MAP_STYLES: Record<MapStyleKey, { label: string; url: string | undefined }> = {
  default:  { label: "Default",   url: undefined },
  bright:   { label: "Streets",   url: "https://tiles.openfreemap.org/styles/bright" },
  liberty:  { label: "3D",        url: "https://tiles.openfreemap.org/styles/liberty" },
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MapsClone() {
  const mapRef = useRef<MapRef>(null);

  // Places
  const [originQuery,  setOriginQuery]  = useState("");
  const [destQuery,    setDestQuery]    = useState("");
  const [originPlace,  setOriginPlace]  = useState<Place | null>(null);
  const [destPlace,    setDestPlace]    = useState<Place | null>(null);
  const [searching,    setSearching]    = useState<"origin" | "dest" | null>(null);
  const [searchError,  setSearchError]  = useState<string | null>(null);

  // Route
  const [routes,        setRoutes]        = useState<RouteData[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [travelMode,    setTravelMode]    = useState<TravelMode>("driving");
  const [loadingRoute,  setLoadingRoute]  = useState(false);
  const [routeError,    setRouteError]    = useState<string | null>(null);

  // Map
  const [viewport,    setViewport]    = useState<MapViewport>({ center: [0, 20], zoom: 2, bearing: 0, pitch: 0 });
  const [mapInfo,     setMapInfo]     = useState({ zoom: 2, lat: 20, lng: 0 });
  const [mapStyle,    setMapStyle]    = useState<MapStyleKey>("default");
  const [placingPin,  setPlacingPin]  = useState<"origin" | "dest" | null>(null);
  const [clickPopup,  setClickPopup]  = useState<{ lng: number; lat: number; name: string } | null>(null);

  // Live location
  const [userLocation,    setUserLocation]    = useState<UserLocation | null>(null);
  const [locating,        setLocating]        = useState(false);
  const [locError,        setLocError]        = useState<string | null>(null);
  const [watchId,         setWatchId]         = useState<number | null>(null);
  const [locationSpeed,   setLocationSpeed]   = useState<number | null>(null);
  const [trackingMode,    setTrackingMode]    = useState(false); // keep map centred on user

  // UI
  const [panelOpen,    setPanelOpen]    = useState(true);
  const [copied,       setCopied]       = useState(false);
  const [darkMode,     setDarkMode]     = useState(false);
  const [showInfo,     setShowInfo]     = useState(false);
  const [isMobile,     setIsMobile]     = useState(false);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Dark mode
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // ── Live location ──
  const startLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocError("Geolocation not supported"); return; }
    setLocating(true);
    setLocError(null);

    // Stop any existing watch
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const loc: UserLocation = {
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
        };
        setUserLocation(loc);
        setLocationSpeed(pos.coords.speed);
        setLocating(false);
        if (trackingMode) {
          mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 15, duration: 800 });
        }
      },
      (err) => {
        setLocError(err.message);
        setLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    setWatchId(id);
  }, [watchId, trackingMode]);

  const stopLocation = useCallback(() => {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); setWatchId(null); }
    setUserLocation(null);
    setTrackingMode(false);
    setLocationSpeed(null);
  }, [watchId]);

  const flyToLocation = useCallback(() => {
    if (!userLocation) { startLocation(); return; }
    mapRef.current?.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 16, duration: 1000 });
  }, [userLocation, startLocation]);

  // Tracking mode: re-centre on every location update
  useEffect(() => {
    if (trackingMode && userLocation) {
      mapRef.current?.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 16, duration: 500 });
    }
  }, [trackingMode, userLocation]);

  // Cleanup watch on unmount
  useEffect(() => () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); }, [watchId]);

  // ── Search ──
  const searchPlace = useCallback(async (which: "origin" | "dest") => {
    const q = which === "origin" ? originQuery : destQuery;
    if (!q.trim()) return;
    setSearching(which);
    setSearchError(null);
    const place = await geocode(q);
    setSearching(null);
    if (!place) { setSearchError(`Could not find "${q}"`); return; }
    if (which === "origin") { setOriginPlace(place); setOriginQuery(place.name); }
    else                    { setDestPlace(place);   setDestQuery(place.name); }
    mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 13, duration: 1000 });
  }, [originQuery, destQuery]);

  // ── Map click ──
  const handleMapClick = useCallback(async (lng: number, lat: number) => {
    if (placingPin) {
      const name = await reverseGeocode(lng, lat);
      const place: Place = { lng, lat, name, displayName: name };
      if (placingPin === "origin") { setOriginPlace(place); setOriginQuery(name); }
      else                         { setDestPlace(place);   setDestQuery(name); }
      setPlacingPin(null);
      return;
    }
    if (!originPlace || !destPlace) {
      const name = await reverseGeocode(lng, lat);
      setClickPopup({ lng, lat, name });
    }
  }, [placingPin, originPlace, destPlace]);

  // ── Fetch route ──
  useEffect(() => {
    if (!originPlace || !destPlace) { setRoutes([]); return; }
    setLoadingRoute(true);
    setRouteError(null);
    setSelectedRoute(0);
    fetchRoute(originPlace, destPlace, travelMode)
      .then(r => { setRoutes(r); if (!r.length) setRouteError("No route found between these locations."); })
      .catch(() => setRouteError("Failed to fetch route. Check your connection."))
      .finally(() => setLoadingRoute(false));

    const minLng = Math.min(originPlace.lng, destPlace.lng);
    const maxLng = Math.max(originPlace.lng, destPlace.lng);
    const minLat = Math.min(originPlace.lat, destPlace.lat);
    const maxLat = Math.max(originPlace.lat, destPlace.lat);
    mapRef.current?.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: isMobile ? 60 : 100, duration: 1000 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originPlace, destPlace, travelMode]);

  // ── Swap ──
  const swap = () => {
    setOriginPlace(destPlace); setDestPlace(originPlace);
    setOriginQuery(destQuery); setDestQuery(originQuery);
  };

  // ── Clear ──
  const clear = () => {
    setOriginPlace(null); setDestPlace(null);
    setOriginQuery(""); setDestQuery("");
    setRoutes([]); setClickPopup(null);
    setRouteError(null); setSearchError(null);
  };

  // ── Share link ──
  const shareRoute = useCallback(() => {
    if (!originPlace || !destPlace) return;
    const url = `https://www.google.com/maps/dir/${originPlace.lat},${originPlace.lng}/${destPlace.lat},${destPlace.lng}`;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }, [originPlace, destPlace]);

  // ── Use location as A ──
  const useLocationAsOrigin = () => {
    if (!userLocation) return;
    reverseGeocode(userLocation.lng, userLocation.lat).then(name => {
      const place = { lng: userLocation.lng, lat: userLocation.lat, name, displayName: name };
      setOriginPlace(place);
      setOriginQuery(name);
    });
  };

  const activeRoute = routes[selectedRoute];
  const sortedRoutes = routes
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.i === selectedRoute ? 1 : b.i === selectedRoute ? -1 : 0);

  const styleUrl = MAP_STYLES[mapStyle].url;
  const modeIcon: Record<TravelMode, React.ReactNode> = {
    driving: <Car className="size-4" />,
    walking: <PersonStanding className="size-4" />,
    cycling: <Bike className="size-4" />,
  };

  const hasRoute = !!(originPlace && destPlace);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="relative h-screen w-full overflow-hidden bg-background font-sans">

      {/* ══════════════════════════════════════════════
          SEARCH PANEL  (left on desktop, top on mobile)
      ══════════════════════════════════════════════ */}
      <div className={`
        absolute z-30 transition-all duration-300
        ${isMobile
          ? `left-0 right-0 top-0 rounded-b-2xl ${panelOpen ? "max-h-[85vh]" : "max-h-20"} overflow-hidden`
          : "left-3 top-3 w-80 rounded-2xl max-h-[calc(100vh-24px)] overflow-hidden flex flex-col"
        }
        border border-border bg-background/97 shadow-2xl backdrop-blur-xl
      `}>

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 flex-1">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary">
              <Navigation className="size-4 text-primary-foreground" />
            </div>
            <span className="font-black text-base tracking-tight text-foreground">MapsCN</span>
          </div>
          <button onClick={() => setDarkMode(d => !d)} className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button onClick={() => setShowInfo(s => !s)} className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <Info className="size-4" />
          </button>
          {isMobile && (
            <button onClick={() => setPanelOpen(o => !o)} className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground transition-colors ml-1">
              {panelOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          )}
        </div>

        {/* Info banner */}
        {showInfo && (
          <div className="border-b border-border bg-blue-50 dark:bg-blue-950/50 px-4 py-2.5 text-xs text-blue-700 dark:text-blue-300 shrink-0">
            <p className="font-semibold mb-0.5">How to use</p>
            <p>Search places → pick travel mode → view routes. Click map to set pins. Drag A/B to update.</p>
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain">

          {/* Search boxes */}
          <div className="p-3 space-y-1.5">
            {/* Origin */}
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${placingPin === "origin" ? "border-green-500 bg-green-50 dark:bg-green-950/40" : "border-border bg-muted/20 focus-within:border-primary/50 focus-within:bg-background"}`}>
              <CircleDot className="size-4 shrink-0 text-green-500" />
              <input
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
                placeholder="Starting point"
                value={originQuery}
                onChange={e => setOriginQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchPlace("origin")}
              />
              {searching === "origin"
                ? <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                : originQuery
                  ? <button onClick={() => { setOriginQuery(""); setOriginPlace(null); setRoutes([]); }} className="shrink-0">
                      <X className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  : <button onClick={() => setPlacingPin(p => p === "origin" ? null : "origin")} className="shrink-0" title="Click map to place">
                      <MapPin className={`size-3.5 ${placingPin === "origin" ? "text-green-500" : "text-muted-foreground hover:text-foreground"}`} />
                    </button>
              }
            </div>

            {/* Swap */}
            <div className="flex justify-center">
              <button onClick={swap} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <ArrowUpDown className="size-3.5" />
              </button>
            </div>

            {/* Destination */}
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${placingPin === "dest" ? "border-red-500 bg-red-50 dark:bg-red-950/40" : "border-border bg-muted/20 focus-within:border-primary/50 focus-within:bg-background"}`}>
              <MapPin className="size-4 shrink-0 text-red-500" />
              <input
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
                placeholder="Destination"
                value={destQuery}
                onChange={e => setDestQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchPlace("dest")}
              />
              {searching === "dest"
                ? <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
                : destQuery
                  ? <button onClick={() => { setDestQuery(""); setDestPlace(null); setRoutes([]); }} className="shrink-0">
                      <X className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  : <button onClick={() => setPlacingPin(p => p === "dest" ? null : "dest")} className="shrink-0" title="Click map to place">
                      <MapPin className={`size-3.5 ${placingPin === "dest" ? "text-red-500" : "text-muted-foreground hover:text-foreground"}`} />
                    </button>
              }
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-0.5">
              <Button size="sm" className="flex-1 gap-1.5 text-xs"
                onClick={() => { searchPlace("origin"); searchPlace("dest"); }}
                disabled={!originQuery && !destQuery}
              >
                <Search className="size-3.5" /> Search
              </Button>
              {hasRoute && (
                <Button size="sm" variant="outline" onClick={shareRoute} className="gap-1.5 text-xs px-3">
                  {copied ? <Check className="size-3.5 text-green-500" /> : <Share2 className="size-3.5" />}
                  {copied ? "Copied!" : "Share"}
                </Button>
              )}
              {(originPlace || destPlace) && (
                <Button size="sm" variant="outline" onClick={clear} className="px-2.5">
                  <RotateCcw className="size-3.5" />
                </Button>
              )}
            </div>

            {/* Errors */}
            {searchError && (
              <div className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 shrink-0" /> {searchError}
              </div>
            )}

            {/* Pin placement hint */}
            {placingPin && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                📍 Click on the map to place <strong>{placingPin === "origin" ? "starting point" : "destination"}</strong>
              </div>
            )}

            {/* Use location as A */}
            {userLocation && !originPlace && (
              <button
                onClick={useLocationAsOrigin}
                className="flex w-full items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 px-3 py-2 text-xs text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors"
              >
                <Locate className="size-3.5 shrink-0" />
                Use my current location as starting point
              </button>
            )}
          </div>

          {/* Travel mode tabs */}
          {hasRoute && (
            <div className="flex border-t border-border">
              {(["driving", "walking", "cycling"] as TravelMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setTravelMode(m)}
                  className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                    travelMode === m
                      ? "border-b-2 border-primary text-primary bg-primary/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {modeIcon[m]}
                  <span>{m}</span>
                </button>
              ))}
            </div>
          )}

          {/* Loading */}
          {loadingRoute && (
            <div className="flex items-center justify-center gap-2 border-t border-border py-5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Calculating route…
            </div>
          )}

          {/* Route error */}
          {!loadingRoute && routeError && (
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                <TriangleAlert className="size-3.5 shrink-0" /> {routeError}
              </div>
            </div>
          )}

          {/* Routes list */}
          {!loadingRoute && routes.length > 0 && (
            <div className="border-t border-border p-3 space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  {routes.length} route{routes.length > 1 ? "s" : ""}
                </p>
                {activeRoute && (
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    {fmtDist(activeRoute.distance)}
                  </p>
                )}
              </div>

              {routes.map((r, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedRoute(i)}
                  className={`w-full rounded-xl px-3 py-3 text-left transition-all border-2 ${
                    selectedRoute === i
                      ? "border-primary bg-primary/5"
                      : "border-transparent bg-muted/20 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className={`flex size-7 items-center justify-center rounded-full ${selectedRoute===i ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {modeIcon[travelMode]}
                    </div>
                    <div>
                      <p className={`text-sm font-bold ${selectedRoute===i ? "text-foreground" : "text-muted-foreground"}`}>
                        {fmtTime(r.duration)}
                      </p>
                      <p className="text-xs text-muted-foreground">{fmtDist(r.distance)}</p>
                    </div>
                    <div className="ml-auto flex flex-col items-end gap-1">
                      {i === 0 && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-bold text-green-700 dark:bg-green-900/50 dark:text-green-400 uppercase tracking-wide">
                          Fastest
                        </span>
                      )}
                      {i === 1 && routes.length > 1 && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-bold text-orange-700 dark:bg-orange-900/50 dark:text-orange-400 uppercase tracking-wide">
                          Alt
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Mini progress bar */}
                  <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${selectedRoute===i ? "bg-primary" : "bg-muted-foreground/30"}`}
                      style={{ width: `${Math.min(100, (routes[0].distance / r.distance) * 70 + 30)}%` }}
                    />
                  </div>
                </button>
              ))}

              {/* Copy coords */}
              {activeRoute && (
                <button
                  onClick={shareRoute}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
                >
                  <Copy className="size-3" />
                  {copied ? "Link copied to clipboard!" : "Copy route link"}
                </button>
              )}
            </div>
          )}

          {/* Live location status */}
          {(userLocation || locating || locError) && (
            <div className="border-t border-border p-3">
              <div className={`rounded-xl px-3 py-2.5 text-xs ${
                locError
                  ? "bg-destructive/10 text-destructive"
                  : "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
              }`}>
                {locating && (
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin shrink-0" />
                    Getting your location…
                  </div>
                )}
                {locError && (
                  <div className="flex items-center gap-2">
                    <TriangleAlert className="size-3.5 shrink-0" /> {locError}
                  </div>
                )}
                {userLocation && !locating && !locError && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="size-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                      <span className="font-semibold">Live location active</span>
                      <button onClick={stopLocation} className="ml-auto rounded px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 transition-colors">
                        Stop
                      </button>
                    </div>
                    <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70 tabular-nums">
                      {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}
                      {" · "}±{Math.round(userLocation.accuracy)}m
                      {locationSpeed !== null && locationSpeed > 0 && ` · ${fmtSpeed(locationSpeed)}`}
                    </p>
                    <div className="flex gap-1.5 pt-0.5">
                      <button
                        onClick={() => setTrackingMode(t => !t)}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
                          trackingMode
                            ? "bg-blue-500 text-white"
                            : "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200"
                        }`}
                      >
                        <Maximize2 className="size-3" />
                        {trackingMode ? "Tracking ON" : "Track me"}
                      </button>
                      <button
                        onClick={useLocationAsOrigin}
                        className="flex items-center gap-1 rounded-lg bg-blue-100 dark:bg-blue-900 px-2 py-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-200 transition-colors"
                      >
                        <CircleDot className="size-3" />
                        Use as A
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>{/* end scrollable */}
      </div>

      {/* ══════════════════════════════════════════════
          BOTTOM ROUTE SUMMARY BAR
      ══════════════════════════════════════════════ */}
      {activeRoute && (
        <div className={`absolute z-20 ${isMobile ? "bottom-4 left-3 right-3" : "bottom-5 left-1/2 -translate-x-1/2 w-auto"}`}>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/97 px-4 py-3 shadow-2xl backdrop-blur-xl flex-wrap">
            <div className={`flex items-center gap-2 text-primary font-black`}>
              {modeIcon[travelMode]}
              <span className="text-lg">{fmtTime(activeRoute.duration)}</span>
            </div>
            <div className="h-5 w-px bg-border hidden sm:block" />
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{fmtDist(activeRoute.distance)}</span>
            </div>
            {!isMobile && (
              <>
                <div className="h-5 w-px bg-border" />
                <div className="text-xs text-muted-foreground max-w-[200px] truncate">
                  {originPlace?.name} → {destPlace?.name}
                </div>
              </>
            )}
            <Button size="sm" className="gap-1.5 ml-auto">
              <Navigation className="size-3.5" /> Start
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          FLOATING ACTION BUTTONS (right side)
      ══════════════════════════════════════════════ */}
      <div className={`absolute z-20 flex flex-col gap-2 ${isMobile ? "right-3 bottom-24" : "right-3 bottom-6"}`}>
        {/* Live location */}
        <button
          onClick={userLocation ? flyToLocation : startLocation}
          disabled={locating}
          title={userLocation ? "Go to my location" : "Show my location"}
          className={`flex size-10 items-center justify-center rounded-xl border border-border shadow-lg backdrop-blur-xl transition-all ${
            userLocation
              ? "bg-blue-500 text-white border-blue-500 hover:bg-blue-600"
              : "bg-background/97 text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          {locating
            ? <Loader2 className="size-4 animate-spin" />
            : <Locate className="size-4" />
          }
        </button>

        {/* Map style cycle */}
        <button
          onClick={() => {
            const keys = Object.keys(MAP_STYLES) as MapStyleKey[];
            const idx = keys.indexOf(mapStyle);
            setMapStyle(keys[(idx + 1) % keys.length]);
          }}
          title={`Switch to ${MAP_STYLES[Object.keys(MAP_STYLES)[(Object.keys(MAP_STYLES).indexOf(mapStyle) + 1) % 3] as MapStyleKey].label}`}
          className="flex size-10 items-center justify-center rounded-xl border border-border bg-background/97 shadow-lg backdrop-blur-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <Layers className="size-4" />
        </button>
      </div>

      {/* ══════════════════════════════════════════════
          MAP STYLE LABEL (top-right, above controls)
      ══════════════════════════════════════════════ */}
      <div className="absolute right-14 top-3 z-20">
        <div className="rounded-lg border border-border bg-background/90 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest backdrop-blur shadow">
          {MAP_STYLES[mapStyle].label}
        </div>
      </div>

      {/* Viewport info — bottom center desktop */}
      {!isMobile && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 pointer-events-none">
          <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-1 font-mono text-[9px] text-muted-foreground/60 backdrop-blur">
            {mapInfo.lat.toFixed(4)}, {mapInfo.lng.toFixed(4)} · zoom {mapInfo.zoom}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          THE MAP
      ══════════════════════════════════════════════ */}
      <Map
        ref={mapRef}
        viewport={viewport}
        onViewportChange={setViewport}
        styles={styleUrl ? { light: styleUrl, dark: styleUrl } : undefined}
        className="h-full w-full"
        fadeDuration={200}
      >
        {/* MapLibre controls */}
        <MapControls
          position="top-right"
          showZoom
          showCompass
          showLocate
          showFullscreen
        />

        {/* Advanced: useMap children */}
        <ViewportTracker onViewport={setMapInfo} />
        <MapClickHandler onMapClick={handleMapClick} />
        <LiveLocationLayer location={userLocation} />

        {/* Routes */}
        {sortedRoutes.map(({ r, i }) => (
          <MapRoute
            key={i}
            coordinates={r.coordinates}
            color={i === selectedRoute ? "#3b82f6" : "#94a3b8"}
            width={i === selectedRoute ? 6 : 4}
            opacity={i === selectedRoute ? 1 : 0.45}
            onClick={() => setSelectedRoute(i)}
          />
        ))}

        {/* Origin marker — draggable */}
        {originPlace && (
          <MapMarker
            longitude={originPlace.lng}
            latitude={originPlace.lat}
            draggable
            onDrag={ll => setOriginPlace(p => p ? { ...p, lng: ll.lng, lat: ll.lat } : null)}
            onDragEnd={async ll => {
              const name = await reverseGeocode(ll.lng, ll.lat);
              setOriginPlace({ lng: ll.lng, lat: ll.lat, name, displayName: name });
              setOriginQuery(name);
            }}
          >
            <MarkerContent>
              <div className="relative flex cursor-move flex-col items-center select-none">
                <div className="flex size-8 items-center justify-center rounded-full border-3 border-white bg-green-500 shadow-lg ring-2 ring-green-500/30 text-white font-black text-sm">
                  A
                </div>
                <div className="-mt-1 h-2 w-1.5 rounded-b-full bg-green-500 shadow" />
              </div>
              <MarkerLabel position="top" className="rounded-full bg-green-500/90 px-2 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur">
                Origin
              </MarkerLabel>
            </MarkerContent>
            <MarkerTooltip>{originPlace.name} — drag to move</MarkerTooltip>
            <MarkerPopup>
              <div className="space-y-1.5 min-w-44">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Starting point</p>
                <p className="font-semibold text-foreground text-sm leading-snug">{originPlace.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {originPlace.lat.toFixed(5)}, {originPlace.lng.toFixed(5)}
                </p>
              </div>
            </MarkerPopup>
          </MapMarker>
        )}

        {/* Destination marker — draggable */}
        {destPlace && (
          <MapMarker
            longitude={destPlace.lng}
            latitude={destPlace.lat}
            draggable
            onDrag={ll => setDestPlace(p => p ? { ...p, lng: ll.lng, lat: ll.lat } : null)}
            onDragEnd={async ll => {
              const name = await reverseGeocode(ll.lng, ll.lat);
              setDestPlace({ lng: ll.lng, lat: ll.lat, name, displayName: name });
              setDestQuery(name);
            }}
          >
            <MarkerContent>
              <div className="relative flex cursor-move flex-col items-center select-none">
                <div className="flex size-8 items-center justify-center rounded-full border-3 border-white bg-red-500 shadow-lg ring-2 ring-red-500/30 text-white font-black text-sm">
                  B
                </div>
                <div className="-mt-1 h-2 w-1.5 rounded-b-full bg-red-500 shadow" />
              </div>
              <MarkerLabel position="top" className="rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur">
                Destination
              </MarkerLabel>
            </MarkerContent>
            <MarkerTooltip>{destPlace.name} — drag to move</MarkerTooltip>
            <MarkerPopup>
              <div className="space-y-1.5 min-w-44">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Destination</p>
                <p className="font-semibold text-foreground text-sm leading-snug">{destPlace.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {destPlace.lat.toFixed(5)}, {destPlace.lng.toFixed(5)}
                </p>
                {activeRoute && (
                  <div className="mt-1 flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
                    <Clock className="size-3 text-muted-foreground" />
                    <span className="text-xs font-semibold">{fmtTime(activeRoute.duration)}</span>
                    <span className="text-xs text-muted-foreground">· {fmtDist(activeRoute.distance)}</span>
                  </div>
                )}
              </div>
            </MarkerPopup>
          </MapMarker>
        )}

        {/* Route midpoint popup */}
        {activeRoute && (() => {
          const mid = activeRoute.coordinates[Math.floor(activeRoute.coordinates.length / 2)];
          return (
            <MapPopup
              longitude={mid[0]}
              latitude={mid[1]}
              closeButton={false}
              closeOnClick={false}
              focusAfterOpen={false}
              offset={10}
              className="p-0"
            >
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold">
                {modeIcon[travelMode]}
                <span>{fmtTime(activeRoute.duration)}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground font-normal">{fmtDist(activeRoute.distance)}</span>
              </div>
            </MapPopup>
          );
        })()}

        {/* Live location popup */}
        {userLocation && (
          <MapPopup
            longitude={userLocation.lng}
            latitude={userLocation.lat}
            closeButton={false}
            closeOnClick={false}
            focusAfterOpen={false}
            offset={18}
            className="p-0"
          >
            <div className="px-2.5 py-1.5 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-blue-600 dark:text-blue-400">
                <div className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
                You are here
              </div>
              {locationSpeed !== null && locationSpeed > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{fmtSpeed(locationSpeed)}</p>
              )}
            </div>
          </MapPopup>
        )}

        {/* Click popup */}
        {clickPopup && (
          <MapPopup
            longitude={clickPopup.lng}
            latitude={clickPopup.lat}
            onClose={() => setClickPopup(null)}
            closeButton
            focusAfterOpen={false}
            closeOnClick={false}
          >
            <div className="space-y-2 min-w-44">
              <p className="font-semibold text-foreground text-sm">{clickPopup.name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {clickPopup.lat.toFixed(5)}, {clickPopup.lng.toFixed(5)}
              </p>
              <div className="flex gap-1.5 pt-0.5">
                <Button size="sm" variant="outline" className="flex-1 text-xs gap-1"
                  onClick={() => {
                    setOriginPlace({ ...clickPopup, displayName: clickPopup.name });
                    setOriginQuery(clickPopup.name);
                    setClickPopup(null);
                  }}
                >
                  <CircleDot className="size-3 text-green-500" /> Set A
                </Button>
                <Button size="sm" className="flex-1 text-xs gap-1"
                  onClick={() => {
                    setDestPlace({ ...clickPopup, displayName: clickPopup.name });
                    setDestQuery(clickPopup.name);
                    setClickPopup(null);
                  }}
                >
                  <MapPin className="size-3" /> Set B
                </Button>
              </div>
            </div>
          </MapPopup>
        )}

      </Map>
    </div>
  );
}