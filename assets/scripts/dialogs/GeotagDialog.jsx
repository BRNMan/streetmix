/* global L */
/* eslint-disable */
import React, { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { FormattedMessage, injectIntl } from 'react-intl'
import { Map, TileLayer, ZoomControl, Marker } from 'react-leaflet'
// todo: re-enable sharedstreets
// sharedstreets functionality is disabled until it stops installing an old
// version of `npm` as a dependency.
// import * as sharedstreets from 'sharedstreets'
import Dialog from './Dialog'
import { PELIAS_HOST_NAME, PELIAS_API_KEY } from '../app/config'
import { trackEvent } from '../app/event_tracking'
import GeoSearch from './Geotag/GeoSearch'
import LocationPopup from './Geotag/LocationPopup'
import { isOwnedByCurrentUser } from '../streets/owner'
import { setMapState } from '../store/slices/map'
import {
  addLocation,
  clearLocation,
  saveStreetName,
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
  lng: -10.78,
}

// Override icon paths in stock Leaflet's stylesheet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/images/marker-icon-2x.png',
  iconUrl: '/images/marker-icon.png',
  shadowUrl: '/images/marker-shadow.png',
})

/**
This Dialog uses the generic Dialog component and combines it with the GeoSearch
and LocationPopup components as well as a map to display the coordinates on
It handles setting, displaying, and clearing location information assocaited with a 'street'
 */

GeotagDialog.propTypes = {
  // Provided by react-intl higher-order component
  intl: PropTypes.object.isRequired,

  // Provided by Redux store
  street: PropTypes.object,
  markerLocation: PropTypes.shape({
    lat: PropTypes.number,
    lng: PropTypes.number,
  }),
  addressInformation: PropTypes.object,
  userLocation: PropTypes.shape({
    latitude: PropTypes.number,
    longitude: PropTypes.number,
  }),
  dpi: PropTypes.number,

  // Provided by Redux action dispatchers
  setMapState: PropTypes.func,
  addLocation: PropTypes.func,
  clearLocation: PropTypes.func,
  saveStreetName: PropTypes.func,
}

// no idea if this is correct syntax
GeotagDialog.defaultProps = {
  dpi: 1.0,
}

function GeotagDialog(props) {
  /* TODO: decide whether to have this be individual vs a reduce function
  see the original conditional logic for the way some of these values are initialy set
  the way they are set together feels like a code smell, but i also couldn't quite
  come with a smart way to refactor it on the spot
  */
  // so each of these could be fed by a function, but is that a good pattern, and where would those live?
  // alot of the params were just being passed from above consts and not used much elsewhere, maybe we should just set them here?
  const [mapCenter, setMapCenter] = useState('initalCenter')
  const [zoom, setZoom] = useState('initialZoom')
  const [renderPopup, setRenderPopup] = useState('initialRenderPopup')
  const [markerLocation, setMarkerLocation] = useState('initalMarkerLocation')
  const [label] = useState('')
  const [bbox] = useState(null)
  const [geocodeAvailable] = useState(true)

  const handleMapClick = (event) => {
    // my instinct is that this function should only reverse gecocode
    // so then if the 'active' latlng is updated, then the other state should
    // be updated accordingly
    // TODO: for later, lets talk about whether this actually best for UX vs other patterns

    // Bail if geocoding is not available.
    if (!geocodeAvailable) return

    const latlng = {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
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
        lng: res.features[0].geometry.coordinates[0],
      }

      setState({
        mapCenter: latlng,
        zoom: zoom,
        renderPopup: true,
        markerLocation: latlng,
        label: res.features[0].properties.label,
        bbox: res.bbox || null,
      })

      props.setMapState({
        markerLocation: latlng,
        addressInformation: res.features[0].properties,
      })
    })
  }

  const handleMarkerDragEnd = (event) => {
    const latlng = event.target.getLatLng()
    // not 100% confident about what to do with 'this' here,
    // especially with these nested functions
    reverseGeocode(latlng).then((res) => {
      this.setState({
        renderPopup: true,
        markerLocation: latlng,
        label: res.features[0].properties.label,
        bbox: res.bbox || null,
      })

      props.setMapState({
        markerLocation: latlng,
        addressInformation: res.features[0].properties,
      })
    })
  }

  /*
  so here can we just set renderPopup to false?
  or do we need to make a 'toggle' function and call it here (which seems extra)
  */
  const handleMarkerDragStart = (event) => {
    this.setState({
      renderPopup: false,
    })
  }

  // questions about to handle this properly in a functional component
  // also; I'd expect the confirm location stuff to be part of location popup
  // since thats where the button is but yah
  const handleConfirmLocation = (event) => {
    const { markerLocation, addressInformation } = props
    // const { bbox } = this.state
    // const point = [markerLocation.lng, markerLocation.lat]

    const location = {
      latlng: markerLocation,
      wofId: addressInformation.id,
      label: addressInformation.label,
      hierarchy: {
        country: addressInformation.country,
        region: addressInformation.region,
        locality: addressInformation.locality,
        neighbourhood: addressInformation.neighbourhood,
        street: addressInformation.street,
      },
      geometryId: null,
      intersectionId: null,
      // geometryId: sharedstreets.geometryId([point]) || null,
      // intersectionId: sharedstreets.intersectionId(point) || null
    }

    // if (bbox) {
    //   const line = [bbox.slice(0, 2), bbox.slice(2, 4)]
    //   location.geometryId = sharedstreets.geometryId(line)
    // }

    trackEvent(
      'Interaction',
      'Geotag dialog: confirm chosen location',
      null,
      null,
      true
    )

    props.addLocation(location)
    props.saveStreetName(location.hierarchy.street, false)
  }

  const handleClearLocation = (event) => {
    trackEvent(
      'Interaction',
      'Geotag dialog: cleared existing location',
      null,
      null,
      true
    )
    props.clearLocation()
  }

  const reverseGeocode = (latlng) => {
    const url = `${REVERSE_GEOCODE_ENDPOINT}&point.lat=${latlng.lat}&point.lon=${latlng.lng}`

    return window.fetch(url).then((response) => response.json())
  }

  const setSearchResults = (point, label, bbox) => {
    const latlng = {
      lat: point[0],
      lng: point[1],
    }

    this.setState({
      zoom: MAP_LOCATION_ZOOM,
      mapCenter: latlng,
      renderPopup: true,
      markerLocation: latlng,
      label: label,
      bbox: bbox || null,
    })
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
    // how to refrence this in hooks? also this.state seems vauge in the first place
    const { markerLocation } = this.state

    return (
      location &&
      location.latlng.lat === markerLocation.lat &&
      location.latlng.lng === markerLocation.lng
    )
  }

  // ok so we gotta get rid of render, but what about this tile URL? and wats
  // this dpi thing
  // render () {
  //
  const tileUrl = props.dpi > 1 ? MAP_TILES_2X : MAP_TILES
  return (
    <Dialog>
      {(closeDialog) => (
        <div className="geotag-dialog">
          {!geocodeAvailable && (
            <div className="geotag-error-banner">
              <FormattedMessage
                id="dialogs.geotag.geotag-unavailable"
                defaultMessage="Geocoding services are currently unavailable. You can view the map,
                    but you won’t be able to change this street’s location."
              />
            </div>
          )}
          {geocodeAvailable && (
            <div className="geotag-input-container">
              <GeoSearch
                setSearchResults={setSearchResults}
                focus={mapCenter}
              />
            </div>
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
              zoomInTitle={props.intl.formatMessage({
                id: 'dialogs.geotag.zoom-in',
                defaultMessage: 'Zoom in',
              })}
              zoomOutTitle={props.intl.formatMessage({
                id: 'dialogs.geotag.zoom-out',
                defaultMessage: 'Zoom out',
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
  // }
}

function mapStateToProps(state) {
  return {
    street: state.street,
    markerLocation: state.map.markerLocation,
    addressInformation: state.map.addressInformation,
    userLocation: state.user.geolocation.data,
    dpi: state.system.devicePixelRatio,
  }
}

// does this still need to be done in a functional component?
const mapDispatchToProps = {
  setMapState,
  addLocation,
  clearLocation,
  saveStreetName,
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(injectIntl(GeotagDialog))
