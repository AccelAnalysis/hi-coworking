import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const MapComponent = () => {
  const position = [36.92904282704385, -76.52067450742162];

  const customIcon = L.icon({
    iconUrl: '/images/hi_map_marker.svg',
    iconSize: [32, 41],
    iconAnchor: [16, 41],
    popupAnchor: [0, -41]
  });

  return (
    <div className="w-full h-64 md:h-80 rounded-2xl overflow-hidden shadow-xl shadow-slate-200/50 border border-white/20">
      <MapContainer center={position} zoom={15} className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        />
        <Marker position={position} icon={customIcon}>
          <Popup>
            Hi Coworking<br />Carrollton, VA<br />
            <button 
              onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${position[0]},${position[1]}`)}
              className="mt-2 px-3 py-1 bg-slate-900 text-white text-sm rounded-md hover:bg-slate-800 transition-colors"
            >
              Get Directions
            </button>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
};

export default MapComponent;
