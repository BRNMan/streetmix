/* eslint-disable react/prop-types */
/* global L */
import React, { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { useIntl } from 'react-intl'
import { Map, TileLayer, ZoomControl, Marker } from 'react-leaflet'
// todo: re-enable sharedstreets
// sharedstreets functionality is disabled until it stops installing an old
// version of `npm` as a dependency.
// import * as sharedstreets from 'sharedstreets'
import Dialog from './Dialog'
import { PELIAS_HOST_NAME, PELIAS_API_KEY } from '../app/config'
import { trackEvent } from '../app/event_tracking'
import ErrorBanner from './Geotag/ErrorBanner'
import GeoSearch from './Geotag/GeoSearch'
import LocationPopup from './Geotag/LocationPopup'
import { isOwnedByCurrentUser } from '../streets/owner'
import { setMapState } from '../store/slices/map'
import {
  addLocation,
  clearLocation,
  saveStreetName
} from '../store/slices/street'
import './GeotagDialog.scss'

const REVERSE_GEOCODE_API = `https://${PELIAS_HOST_NAME}/v1/reverse`
const REVERSE_GEOCODE_ENDPOINT = `${REVERSE_GEOCODE_API}?api_key=${PELIAS_API_KEY}`
const MAP_TILES =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
const MAP_TILES_2X =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'
const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attribution">CARTO</a>'
// zoom level for a closer, 'street' zoom level
const MAP_LOCATION_ZOOM = 12

// Default location if geo IP not detected; this hovers over the Atlantic Ocean
const DEFAULT_MAP_ZOOM = 2
const DEFAULT_MAP_LOCATION = {
  lat: 10.45,
  lng: -10.78
}

// Override icon paths in stock Leaflet's stylesheet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/images/marker-icon-2x.png',
  iconUrl: '/images/marker-icon.png',
  shadowUrl: '/images/marker-shadow.png'
})

/**
This Dialog uses the generic Dialog component and combines it with the GeoSearch
and LocationPopup components as well as a map to display the coordinates on
It handles setting, displaying, and clearing location information assocaited with a 'street'
 */

function getInitialState (props) {
  // Determine initial map center, and what to display
  let mapCenter, zoom, markerLocation, label

  // If street has a location object, use its position and data
  if (props.street.location) {
    mapCenter = props.street.location.latlng
    zoom = MAP_LOCATION_ZOOM
    markerLocation = props.street.location.latlng
    label = props.street.location.label
    // If we've previously saved marker position, re-use that information
  } else if (props.markerLocation) {
    mapCenter = props.markerLocation
    zoom = MAP_LOCATION_ZOOM
    markerLocation = props.markerLocation
    label = props.addressInformation.label
    // If there's no prior location data, use the user's location, if available
    // In this case, display the map view, but no marker or popup
  } else if (props.userLocation) {
    mapCenter = {
      lat: props.userLocation.latitude,
      lng: props.userLocation.longitude
    }
    zoom = MAP_LOCATION_ZOOM
    // As a last resort, show an overview of the world.
  } else {
    mapCenter = DEFAULT_MAP_LOCATION
    zoom = DEFAULT_MAP_ZOOM
  }

  return {
    mapCenter,
    zoom,
    markerLocation,
    label
  }
}

function GeotagDialog () {
  /* TODO: decide whether to have this be individual vs a reduce function
  see the original conditional logic for the way some of these values are initialy set
  the way they are set together feels like a code smell, but i also couldn't quite
  come with a smart way to refactor it on the spot
  */
  // so each of these could be fed by a function, but is that a good pattern, and where would those live?
  // alot of the params were just being passed from above consts and not used much elsewhere, maybe we should just set them here?
  const props = {
    street: useSelector((state) => state.street),
    markerLocation: useSelector((state) => state.map.markerLocation),
    addressInformation: useSelector((state) => state.map.addressInformation),
    userLocation: useSelector((state) => state.user.geolocation.data)
  }
  const dpi = useSelector((state) => state.system.devicePixelRatio || 1.0)
  const dispatch = useDispatch()
  const initialState = getInitialState(props)
  const [mapCenter, setMapCenter] = useState(initialState.mapCenter)
  const [zoom, setZoom] = useState(initialState.zoom)
  const [markerLocation, setMarkerLocation] = useState(
    initialState.markerLocation
  )
  const [label, setLabel] = useState(initialState.label)
  const [renderPopup, setRenderPopup] = useState(!!initialState.markerLocation)
  const intl = useIntl()

  const geocodeAvailable = !!PELIAS_API_KEY

  // `dpi` is a bad name for what is supposed to be referring to the devicePixelRatio
  // value. A devicePixelRatio higher than 1 (e.g. Retina or 4k monitors) will load
  // higher resolution map tiles.
  const tileUrl = dpi > 1 ? MAP_TILES_2X : MAP_TILES

  const handleMapClick = (event) => {
    // my instinct is that this function should only reverse gecocode
    // so then if the 'active' latlng is updated, then the other state should
    // be updated accordingly
    // TODO: for later, lets talk about whether this actually best for UX vs other patterns

    // Bail if geocoding is not available.
    if (!geocodeAvailable) return

    const latlng = {
      lat: event.latlng.lat,
      lng: event.latlng.lng
    }

    // this is in the context of a a map click, we don't want to switch up
    // the zoom level on the user
    // (or at least im assuming this based on the code ;-))
    const zoom = event.target.getZoom()

    /*
    we reset state + reverse geocode on click
    we also do the same thing on drag end
    thats some pretty obvious copypasta to
    clean up if/when we add to geocoding/map functionality
    */
    reverseGeocode(latlng).then((res) => {
      const latlng = {
        lat: res.features[0].geometry.coordinates[1],
        lng: res.features[0].geometry.coordinates[0]
      }

      setMapCenter(latlng)
      setZoom(zoom)
      setRenderPopup(true)
      setMarkerLocation(latlng)
      setLabel(res.features[0].properties.label)

      dispatch(
        setMapState({
          markerLocation: latlng,
          addressInformation: res.features[0].properties
        })
      )
    })
  }

  const handleMarkerDragEnd = (event) => {
    const latlng = event.target.getLatLng()
    // not 100% confident about what to do with 'this' here,
    // especially with these nested functions
    reverseGeocode(latlng).then((res) => {
      setRenderPopup(true)
      setMarkerLocation(latlng)
      setLabel(res.features[0].properties.label)

      dispatch(
        setMapState({
          markerLocation: latlng,
          addressInformation: res.features[0].properties
        })
      )
    })
  }

  /*
  so here can we just set renderPopup to false?
  or do we need to make a 'toggle' function and call it here (which seems extra)
  */
  const handleMarkerDragStart = (event) => {
    setRenderPopup(true)
  }

  // questions about to handle this properly in a functional component
  // also; I'd expect the confirm location stuff to be part of location popup
  // since thats where the button is but yah
  const handleConfirmLocation = (event) => {
    const { markerLocation, addressInformation } = props

    const location = {
      latlng: markerLocation,
      wofId: addressInformation.id,
      label: addressInformation.label,
      hierarchy: {
        country: addressInformation.country,
        region: addressInformation.region,
        locality: addressInformation.locality,
        neighbourhood: addressInformation.neighbourhood,
        street: addressInformation.street
      },
      geometryId: null,
      intersectionId: null
    }

    trackEvent(
      'Interaction',
      'Geotag dialog: confirm chosen location',
      null,
      null,
      true
    )

    // TODO: batch dispatches so we don't trigger multiple re-renders in the same update
    dispatch(addLocation(location))
    dispatch(saveStreetName(location.hierarchy.street, false))
  }

  const handleClearLocation = (event) => {
    trackEvent(
      'Interaction',
      'Geotag dialog: cleared existing location',
      null,
      null,
      true
    )
    dispatch(clearLocation())
  }

  const reverseGeocode = (latlng) => {
    const url = `${REVERSE_GEOCODE_ENDPOINT}&point.lat=${latlng.lat}&point.lon=${latlng.lng}`

    return window.fetch(url).then((response) => response.json())
  }

  const setSearchResults = (point, label) => {
    const latlng = {
      lat: point[0],
      lng: point[1]
    }

    setZoom(MAP_LOCATION_ZOOM)
    setMapCenter(latlng)
    setRenderPopup(true)
    setMarkerLocation(latlng)
    setLabel(label)
  }

  /**
   * Determines if the street location can be saved or edited.
   */
  const canEditLocation = () => {
    const { street } = props
    // The street is editable if either of the following conditions are true:
    //  - If there is a street owner, and it's equal to the current user
    //  - If there is no street owner
    //  - If there is no street location saved.
    return isOwnedByCurrentUser() || !street.creatorId || !street.location
  }

  /**
   * Location can be cleared from a street that has a saved location, and
   * if that location is equal to the current marker position.
   * This does not check for street ownership. See `canEditLocation()` for that.
   */
  const canClearLocation = () => {
    const { location } = props.street

    return (
      location &&
      location.latlng.lat === markerLocation.lat &&
      location.latlng.lng === markerLocation.lng
    )
  }

  return (
    <Dialog>
      {(closeDialog) => (
        <div className="geotag-dialog">
          {geocodeAvailable ? (
            <div className="geotag-input-container">
              <GeoSearch
                setSearchResults={setSearchResults}
                focus={mapCenter}
              />
            </div>
          ) : (
            <ErrorBanner />
          )}
          <Map
            center={mapCenter}
            zoomControl={false}
            zoom={zoom}
            onClick={handleMapClick}
            useFlyTo={true}
          >
            <TileLayer attribution={MAP_ATTRIBUTION} url={tileUrl} />
            <ZoomControl
              zoomInTitle={intl.formatMessage({
                id: 'dialogs.geotag.zoom-in',
                defaultMessage: 'Zoom in'
              })}
              zoomOutTitle={intl.formatMessage({
                id: 'dialogs.geotag.zoom-out',
                defaultMessage: 'Zoom out'
              })}
            />

            {renderPopup && (
              <LocationPopup
                position={markerLocation}
                label={label}
                isEditable={geocodeAvailable && canEditLocation()}
                isClearable={geocodeAvailable && canClearLocation()}
                handleConfirm={(e) => {
                  handleConfirmLocation(e)
                  closeDialog()
                }}
                handleClear={(e) => {
                  handleClearLocation(e)
                  closeDialog()
                }}
              />
            )}

            {markerLocation && (
              <Marker
                position={markerLocation}
                onDragEnd={handleMarkerDragEnd}
                onDragStart={handleMarkerDragStart}
                draggable={geocodeAvailable}
              />
            )}
          </Map>
        </div>
      )}
    </Dialog>
  )
}

export default GeotagDialog
