"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
  distance: number; // metres
  duration: number; // seconds
}

type TravelMode = "driving" | "walking" | "cycling";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function fmtTime(s: number) {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Nominatim geocode
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

// Nominatim reverse geocode
async function reverseGeocode(lng: number, lat: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    return data.display_name?.split(",")[0] ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// OSRM route
const OSRM_PROFILE: Record<TravelMode, string> = {
  driving: "driving",
  walking: "foot",
  cycling: "bike",
};

async function fetchRoute(
  from: Place,
  to: Place,
  mode: TravelMode
): Promise<RouteData[]> {
  const profile = OSRM_PROFILE[mode];
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=true`
  );
  const data = await res.json();
  if (!data.routes?.length) return [];
  return data.routes.map((r: { geometry: { coordinates: [number,number][] }; distance: number; duration: number }) => ({
    coordinates: r.geometry.coordinates,
    distance: r.distance,
    duration: r.duration,
  }));
}

// ─── Map click handler (child of Map) ────────────────────────────────────────
function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (lng: number, lat: number) => void;
}) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const handler = (e: { lngLat: { lng: number; lat: number } }) => {
      onMapClick(e.lngLat.lng, e.lngLat.lat);
    };
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [map, isLoaded, onMapClick]);
  return null;
}

// ─── Viewport tracker (child of Map, using useMap hook) ──────────────────────
function ViewportTracker({
  onViewport,
}: {
  onViewport: (v: { zoom: number; pitch: number; bearing: number }) => void;
}) {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const handler = () => {
      onViewport({
        zoom: Math.round(map.getZoom() * 10) / 10,
        pitch: Math.round(map.getPitch()),
        bearing: Math.round(map.getBearing()),
      });
    };
    map.on("move", handler);
    return () => { map.off("move", handler); };
  }, [map, isLoaded, onViewport]);
  return null;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function GoogleMapsClone() {
  const mapRef = useRef<MapRef>(null);

  // Search
  const [originQuery,  setOriginQuery]  = useState("");
  const [destQuery,    setDestQuery]    = useState("");
  const [originPlace,  setOriginPlace]  = useState<Place | null>(null);
  const [destPlace,    setDestPlace]    = useState<Place | null>(null);
  const [searching,    setSearching]    = useState<"origin"|"dest"|null>(null);
  const [searchError,  setSearchError]  = useState<string|null>(null);

  // Route
  const [routes,         setRoutes]         = useState<RouteData[]>([]);
  const [selectedRoute,  setSelectedRoute]  = useState(0);
  const [travelMode,     setTravelMode]     = useState<TravelMode>("driving");
  const [loadingRoute,   setLoadingRoute]   = useState(false);

  // Map state
  const [viewport, setViewport] = useState<MapViewport>({
    center: [0, 20], zoom: 2, bearing: 0, pitch: 0,
  });
  const [mapInfo, setMapInfo] = useState({ zoom: 2, pitch: 0, bearing: 0 });
  const [mapStyle, setMapStyle] = useState<"default"|"satellite">("default");
  const [clickPopup, setClickPopup] = useState<{ lng: number; lat: number; name: string } | null>(null);
  const [placingPin, setPlacingPin] = useState<"origin"|"dest"|null>(null);

  // ── Search place ──
  const searchPlace = useCallback(async (which: "origin"|"dest") => {
    const q = which === "origin" ? originQuery : destQuery;
    if (!q.trim()) return;
    setSearching(which);
    setSearchError(null);
    const place = await geocode(q);
    setSearching(null);
    if (!place) { setSearchError(`Could not find "${q}"`); return; }
    if (which === "origin") {
      setOriginPlace(place);
      setOriginQuery(place.name);
    } else {
      setDestPlace(place);
      setDestQuery(place.name);
    }
    mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 13, duration: 1000 });
  }, [originQuery, destQuery]);

  // ── Map click → place pin ──
  const handleMapClick = useCallback(async (lng: number, lat: number) => {
    if (!placingPin) {
      // show a generic popup
      const name = await reverseGeocode(lng, lat);
      setClickPopup({ lng, lat, name });
      return;
    }
    const name = await reverseGeocode(lng, lat);
    const place: Place = { lng, lat, name, displayName: name };
    if (placingPin === "origin") {
      setOriginPlace(place);
      setOriginQuery(name);
    } else {
      setDestPlace(place);
      setDestQuery(name);
    }
    setPlacingPin(null);
    setClickPopup(null);
  }, [placingPin]);

  // ── Fetch route whenever both places or mode changes ──
  useEffect(() => {
    if (!originPlace || !destPlace) { setRoutes([]); return; }
    setLoadingRoute(true);
    setSelectedRoute(0);
    fetchRoute(originPlace, destPlace, travelMode)
      .then(setRoutes)
      .catch(() => setRoutes([]))
      .finally(() => setLoadingRoute(false));

    // Fit map to both points
    const minLng = Math.min(originPlace.lng, destPlace.lng);
    const maxLng = Math.max(originPlace.lng, destPlace.lng);
    const minLat = Math.min(originPlace.lat, destPlace.lat);
    const maxLat = Math.max(originPlace.lat, destPlace.lat);
    mapRef.current?.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 80, duration: 1000 }
    );
  }, [originPlace, destPlace, travelMode]);

  // ── Swap ──
  const swap = () => {
    setOriginPlace(destPlace);
    setDestPlace(originPlace);
    setOriginQuery(destQuery);
    setDestQuery(originQuery);
  };

  // ── Clear ──
  const clear = () => {
    setOriginPlace(null); setDestPlace(null);
    setOriginQuery(""); setDestQuery("");
    setRoutes([]); setClickPopup(null);
  };

  const sortedRoutes = routes
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.i === selectedRoute ? 1 : b.i === selectedRoute ? -1 : 0);

  const activeRoute = routes[selectedRoute];

  const MODE_ICONS: Record<TravelMode, React.ReactNode> = {
    driving: <Car className="size-4" />,
    walking: <PersonStanding className="size-4" />,
    cycling: <Bike className="size-4" />,
  };

  const mapStyleUrl = mapStyle === "satellite"
    ? "https://tiles.openfreemap.org/styles/bright"
    : undefined; // default carto

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background">

      {/* ── TOP SEARCH PANEL ── */}
      <div className="absolute left-3 top-3 z-20 w-80 rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur-xl">

        {/* Search boxes */}
        <div className="space-y-1 p-3">
          {/* Origin */}
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
            <CircleDot className="size-4 shrink-0 text-green-500" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Choose starting point"
              value={originQuery}
              onChange={e => setOriginQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchPlace("origin")}
            />
            {searching === "origin"
              ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              : originQuery
                ? <button onClick={() => { setOriginQuery(""); setOriginPlace(null); setRoutes([]); }}>
                    <X className="size-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                : <button onClick={() => setPlacingPin("origin")} title="Drop pin">
                    <MapPin className={`size-3.5 ${placingPin==="origin" ? "text-green-500" : "text-muted-foreground hover:text-foreground"}`} />
                  </button>
            }
          </div>

          {/* Swap button */}
          <div className="flex justify-center">
            <button
              onClick={swap}
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowUpDown className="size-3.5" />
            </button>
          </div>

          {/* Destination */}
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
            <MapPin className="size-4 shrink-0 text-red-500" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Choose destination"
              value={destQuery}
              onChange={e => setDestQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && searchPlace("dest")}
            />
            {searching === "dest"
              ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              : destQuery
                ? <button onClick={() => { setDestQuery(""); setDestPlace(null); setRoutes([]); }}>
                    <X className="size-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                : <button onClick={() => setPlacingPin("dest")} title="Drop pin">
                    <MapPin className={`size-3.5 ${placingPin==="dest" ? "text-red-500" : "text-muted-foreground hover:text-foreground"}`} />
                  </button>
            }
          </div>

          {/* Search + Clear buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={() => { searchPlace("origin"); searchPlace("dest"); }}
              disabled={!originQuery && !destQuery}
            >
              <Search className="size-3.5" />
              Search
            </Button>
            {(originPlace || destPlace) && (
              <Button size="sm" variant="outline" onClick={clear}>
                <RotateCcw className="size-3.5" />
              </Button>
            )}
          </div>

          {searchError && (
            <p className="text-xs text-destructive px-1">{searchError}</p>
          )}

          {placingPin && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              Click anywhere on the map to drop a pin for <strong>{placingPin === "origin" ? "starting point" : "destination"}</strong>
            </p>
          )}
        </div>

        {/* Travel mode */}
        {(originPlace || destPlace) && (
          <div className="flex border-t border-border">
            {(["driving","walking","cycling"] as TravelMode[]).map(m => (
              <button
                key={m}
                onClick={() => setTravelMode(m)}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  travelMode === m
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {MODE_ICONS[m]}
                <span className="capitalize">{m}</span>
              </button>
            ))}
          </div>
        )}

        {/* Route results */}
        {loadingRoute && (
          <div className="flex items-center justify-center gap-2 border-t border-border py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Fetching routes…
          </div>
        )}

        {!loadingRoute && routes.length > 0 && (
          <div className="border-t border-border p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-1">
              {routes.length} route{routes.length > 1 ? "s" : ""} found
            </p>
            {routes.map((r, i) => (
              <button
                key={i}
                onClick={() => setSelectedRoute(i)}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition-all border ${
                  selectedRoute === i
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Route className={`size-3.5 ${selectedRoute===i ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-sm font-semibold ${selectedRoute===i ? "text-foreground" : "text-muted-foreground"}`}>
                    {fmtTime(r.duration)}
                  </span>
                  {i === 0 && (
                    <span className="ml-auto rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:bg-green-900 dark:text-green-300">
                      Fastest
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" /> {fmtTime(r.duration)}
                  </span>
                  <span>·</span>
                  <span>{fmtDist(r.distance)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {!loadingRoute && originPlace && destPlace && routes.length === 0 && (
          <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            No route found between these locations.
          </div>
        )}
      </div>

      {/* ── BOTTOM SUMMARY BAR (when route active) ── */}
      {activeRoute && (
        <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-4 rounded-2xl border border-border bg-background/95 px-6 py-3 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-2 text-primary">
              {MODE_ICONS[travelMode]}
              <span className="text-lg font-black">{fmtTime(activeRoute.duration)}</span>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{fmtDist(activeRoute.distance)}</span>
              {" "}via fastest route
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="text-xs text-muted-foreground">
              {originPlace?.name} → {destPlace?.name}
            </div>
            <Button size="sm" className="gap-1.5 ml-2">
              <Navigation className="size-3.5" />
              Start
            </Button>
          </div>
        </div>
      )}

      {/* ── MAP STYLE + INFO (bottom-right) ── */}
      <div className="absolute bottom-6 right-4 z-20 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-background/90 px-2 py-1 text-[10px] font-mono text-muted-foreground backdrop-blur">
          <span>zoom {mapInfo.zoom}</span>
          <span>·</span>
          <span>pitch {mapInfo.pitch}°</span>
          <span>·</span>
          <span>bearing {mapInfo.bearing}°</span>
        </div>
        <button
          onClick={() => setMapStyle(s => s === "default" ? "satellite" : "default")}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow backdrop-blur hover:bg-muted"
        >
          <Layers className="size-3.5" />
          {mapStyle === "default" ? "Satellite" : "Default"}
        </button>
      </div>

      {/* ── THE MAP ── */}
      <Map
        ref={mapRef}
        viewport={viewport}
        onViewportChange={setViewport}
        styles={mapStyleUrl ? { light: mapStyleUrl, dark: mapStyleUrl } : undefined}
        className="h-full w-full"
        fadeDuration={200}
      >
        {/* Controls — zoom, compass, locate, fullscreen */}
        <MapControls
          position="top-right"
          showZoom
          showCompass
          showLocate
          showFullscreen
        />

        {/* Advanced: viewport tracker via useMap hook */}
        <ViewportTracker onViewport={setMapInfo} />

        {/* Advanced: map click handler via useMap hook */}
        <MapClickHandler onMapClick={handleMapClick} />

        {/* Routes — sorted so selected renders on top */}
        {sortedRoutes.map(({ r, i }) => (
          <MapRoute
            key={i}
            coordinates={r.coordinates}
            color={i === selectedRoute ? "#3b82f6" : "#94a3b8"}
            width={i === selectedRoute ? 6 : 4}
            opacity={i === selectedRoute ? 1 : 0.5}
            onClick={() => setSelectedRoute(i)}
          />
        ))}

        {/* Origin marker — draggable */}
        {originPlace && (
          <MapMarker
            longitude={originPlace.lng}
            latitude={originPlace.lat}
            draggable
            onDrag={lngLat => {
              setOriginPlace(p => p ? { ...p, lng: lngLat.lng, lat: lngLat.lat } : null);
            }}
            onDragEnd={async lngLat => {
              const name = await reverseGeocode(lngLat.lng, lngLat.lat);
              setOriginPlace({ lng: lngLat.lng, lat: lngLat.lat, name, displayName: name });
              setOriginQuery(name);
            }}
          >
            <MarkerContent>
              <div className="relative flex cursor-move items-center justify-center">
                <div className="size-4 rounded-full border-3 border-white bg-green-500 shadow-lg ring-2 ring-green-500/30" />
                <div className="absolute -bottom-1 size-2 rotate-45 rounded-sm bg-green-500 shadow" />
              </div>
              <MarkerLabel
                position="top"
                className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold text-white shadow"
              >
                A
              </MarkerLabel>
            </MarkerContent>
            <MarkerTooltip>
              {originPlace.name} — drag to move
            </MarkerTooltip>
            <MarkerPopup>
              <div className="space-y-1 min-w-40">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Starting point</p>
                <p className="font-semibold text-foreground">{originPlace.name}</p>
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
            onDrag={lngLat => {
              setDestPlace(p => p ? { ...p, lng: lngLat.lng, lat: lngLat.lat } : null);
            }}
            onDragEnd={async lngLat => {
              const name = await reverseGeocode(lngLat.lng, lngLat.lat);
              setDestPlace({ lng: lngLat.lng, lat: lngLat.lat, name, displayName: name });
              setDestQuery(name);
            }}
          >
            <MarkerContent>
              <div className="relative flex cursor-move flex-col items-center">
                <div className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-red-500 shadow-lg ring-2 ring-red-500/30">
                  <MapPin className="size-3.5 fill-white text-white" />
                </div>
                <div className="-mt-1 size-2 rounded-b-full bg-red-500" />
              </div>
              <MarkerLabel
                position="top"
                className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white shadow"
              >
                B
              </MarkerLabel>
            </MarkerContent>
            <MarkerTooltip>
              {destPlace.name} — drag to move
            </MarkerTooltip>
            <MarkerPopup>
              <div className="space-y-1 min-w-40">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Destination</p>
                <p className="font-semibold text-foreground">{destPlace.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {destPlace.lat.toFixed(5)}, {destPlace.lng.toFixed(5)}
                </p>
                {activeRoute && (
                  <div className="mt-2 border-t border-border pt-2">
                    <p className="text-xs text-muted-foreground">
                      {fmtDist(activeRoute.distance)} · {fmtTime(activeRoute.duration)}
                    </p>
                  </div>
                )}
              </div>
            </MarkerPopup>
          </MapMarker>
        )}

        {/* Midpoint distance popup on active route */}
        {activeRoute && (() => {
          const mid = activeRoute.coordinates[Math.floor(activeRoute.coordinates.length / 2)];
          return (
            <MapPopup
              longitude={mid[0]}
              latitude={mid[1]}
              closeButton={false}
              closeOnClick={false}
              focusAfterOpen={false}
              className="p-0"
              offset={8}
            >
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold">
                {MODE_ICONS[travelMode]}
                <span>{fmtTime(activeRoute.duration)}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{fmtDist(activeRoute.distance)}</span>
              </div>
            </MapPopup>
          );
        })()}

        {/* Click popup (no markers placed) */}
        {clickPopup && !originPlace && !destPlace && (
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
              <div className="flex gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => {
                    setOriginPlace({ ...clickPopup, displayName: clickPopup.name });
                    setOriginQuery(clickPopup.name);
                    setClickPopup(null);
                  }}
                >
                  Set as A
                </Button>
                <Button
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => {
                    setDestPlace({ ...clickPopup, displayName: clickPopup.name });
                    setDestQuery(clickPopup.name);
                    setClickPopup(null);
                  }}
                >
                  Set as B
                </Button>
              </div>
            </div>
          </MapPopup>
        )}
      </Map>
    </div>
  );
}