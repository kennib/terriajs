'use strict';

const CesiumMath = require('terriajs-cesium/Source/Core/Math');
const createCatalogMemberFromType = require('../../Models/createCatalogMemberFromType');
const defaultValue = require('terriajs-cesium/Source/Core/defaultValue');
const defined = require('terriajs-cesium/Source/Core/defined');
const GeoJsonCatalogItem = require('../../Models/GeoJsonCatalogItem');
const ImageryLayerCatalogItem = require('../../Models/ImageryLayerCatalogItem');
const ObserveModelMixin = require('../ObserveModelMixin');
const OpenStreetMapCatalogItem = require('../../Models/OpenStreetMapCatalogItem');
const React = require('react');
const Terria = require('../../Models/Terria');
const TerriaViewer = require('../../ViewModels/TerriaViewer.js');
const ViewerMode = require('../../Models/ViewerMode');
const when = require('terriajs-cesium/Source/ThirdParty/when');

const DataPreviewMap = React.createClass({
    mixins: [ObserveModelMixin],

    propTypes: {
        terria: React.PropTypes.object.isRequired,
        previewedCatalogItem: React.PropTypes.object
    },

    componentWillMount() {
        const terria = this.props.terria;

        this.terriaPreview = new Terria({
            appName: terria.appName + ' preview',
            supportEmail: terria.supportEmail,
            baseUrl: terria.baseUrl,
            cesiumBaseUrl: terria.cesiumBaseUrl
        });

        this.terriaPreview.viewerMode = ViewerMode.Leaflet;
        this.terriaPreview.homeView = terria.homeView;
        this.terriaPreview.initialView = terria.homeView;
        this.terriaPreview.regionMappingDefinitionsUrl = terria.regionMappingDefinitionsUrl;

        // TODO: we shouldn't hard code the base map here. (copied from branch analyticsWithCharts)
        const positron = new OpenStreetMapCatalogItem(this.terriaPreview);
        positron.name = 'Positron (Light)';
        positron.url = 'http://basemaps.cartocdn.com/light_all/';
        positron.attribution = '© OpenStreetMap contributors ODbL, © CartoDB CC-BY 3.0';
        positron.opacity = 1.0;
        positron.subdomains = ['a', 'b', 'c', 'd'];
        this.terriaPreview.baseMap = positron;

        this.isZoomedToExtent = false;
        this.lastPreviewedCatalogItem = undefined;
        this.removePreviewFromMap = undefined;
    },

    componentDidMount() {
        this.updatePreview();
    },

    componentDidUpdate() {
        this.updatePreview();
    },

    updatePreview() {
        if (this.lastPreviewedCatalogItem === this.props.previewedCatalogItem) {
            return;
        }

        this.isZoomedToExtent = false;
        this.terriaPreview.currentViewer.zoomTo(this.terriaPreview.homeView);

        if (defined(this.removePreviewFromMap)) {
            this.removePreviewFromMap();
            this.removePreviewFromMap = undefined;
        }

        if (defined(this.rectangleCatalogItem)) {
            this.rectangleCatalogItem.isEnabled = false;
        }

        let previewed = this.props.previewedCatalogItem;
        if (previewed && defined(previewed.type) && previewed.isMappable) {
            const that = this;
            return when(previewed.load()).then(function() {
                // If this item has a separate now viewing item, load it before continuing.
                let nowViewingItem;
                let loadNowViewingItemPromise;
                if (defined(previewed.nowViewingCatalogItem)) {
                    nowViewingItem = previewed.nowViewingCatalogItem;
                    loadNowViewingItemPromise = when(nowViewingItem.load());
                } else {
                    nowViewingItem = previewed;
                    loadNowViewingItemPromise = when();
                }

                return loadNowViewingItemPromise.then(function() {
                    // Now that the item is loaded, add it to the map.
                    // Unless we've started previewing something else in the meantime!
                    if (!that.isMounted() || previewed !== that.props.previewedCatalogItem) {
                        return;
                    }

                    // if (defined(that.removePreviewFromMap)) {
                    //     that.removePreviewFromMap();
                    //     that.removePreviewFromMap = undefined;
                    // }

                    if (defined(nowViewingItem._createImageryProvider)) {
                        const imageryProvider = nowViewingItem._createImageryProvider();
                        const layer = ImageryLayerCatalogItem.enableLayer(nowViewingItem, imageryProvider, nowViewingItem.opacity, undefined, that.terriaPreview);
                        ImageryLayerCatalogItem.showLayer(nowViewingItem, layer, that.terriaPreview);
                        that.updateBoundingRectangle(nowViewingItem);

                        that.removePreviewFromMap = function() {
                            ImageryLayerCatalogItem.hideLayer(nowViewingItem, layer, that.terriaPreview);
                            ImageryLayerCatalogItem.disableLayer(nowViewingItem, layer, that.terriaPreview);
                        };
                    } else {
                        // const type = previewed.type;
                        // const serializedCatalogItem = previewed.serializeToJson();
                        // const catalogItem = createCatalogMemberFromType(type, that.terriaPreview);

                        // catalogItem.updateFromJson(serializedCatalogItem);
                        // catalogItem.isEnabled = true;

                        // that.updateBoundingRectangle(catalogItem);

                        // that.removePreviewFromMap = function() {
                        //     catalogItem.isEnabled = false;
                        // };
                    }
                });
            });
        }
    },

    clickMap() {
        if (!defined(this.props.previewedCatalogItem)) {
            return;
        }

        this.isZoomedToExtent = !this.isZoomedToExtent;

        if (this.isZoomedToExtent) {
            const catalogItem = defaultValue(this.props.previewedCatalogItem.nowViewingCatalogItem, this.props.previewedCatalogItem);
            if (defined(catalogItem.rectangle)) {
                this.terriaPreview.currentViewer.zoomTo(catalogItem.rectangle);
            }
        } else {
            this.terriaPreview.currentViewer.zoomTo(this.terriaPreview.homeView);
        }

        this.updateBoundingRectangle();
    },

    updateBoundingRectangle(previewed) {
        if (defined(this.rectangleCatalogItem)) {
            this.rectangleCatalogItem.isEnabled = false;
            this.rectangleCatalogItem = undefined;
        }

        let catalogItem = defaultValue(previewed, this.props.previewedCatalogItem);
        catalogItem = defaultValue(catalogItem.nowViewingCatalogItem, catalogItem);

        if (!defined(catalogItem) || !defined(catalogItem.rectangle)) {
            return;
        }

        let west = catalogItem.rectangle.west;
        let south = catalogItem.rectangle.south;
        let east = catalogItem.rectangle.east;
        let north = catalogItem.rectangle.north;

        if (!this.isZoomedToExtent) {
            // When zoomed out, make sure the dataset rectangle is at least 5% of the width and height
            // the home view, so that it is actually visible.
            const minimumFraction = 0.05;
            const homeView = this.terriaPreview.homeView.rectangle;

            const minimumWidth = (homeView.east - homeView.west) * minimumFraction;
            if ((east - west) < minimumWidth) {
                const center = (east + west) * 0.5;
                west = center - minimumWidth * 0.5;
                east = center + minimumWidth * 0.5;
            }

            const minimumHeight = (homeView.north - homeView.south) * minimumFraction;
            if ((north - south) < minimumHeight) {
                const center = (north + south) * 0.5;
                south = center - minimumHeight * 0.5;
                north = center + minimumHeight * 0.5;
            }
        }

        west = CesiumMath.toDegrees(west);
        south = CesiumMath.toDegrees(south);
        east = CesiumMath.toDegrees(east);
        north = CesiumMath.toDegrees(north);

        this.rectangleCatalogItem = new GeoJsonCatalogItem(this.terriaPreview);
        this.rectangleCatalogItem.data = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: {
                        stroke: '#08ABD5',
                        'stroke-width': 2,
                        'stroke-opacity': 1,
                        fill: '#555555',
                        'fill-opacity': 0
                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [
                            [
                                [west, south],
                                [west, north],
                                [east, north],
                                [east, south],
                                [west, south]
                            ]
                        ]
                    }
                }
            ]
        };
        this.rectangleCatalogItem.isEnabled = true;
    },

    mapIsReady(mapContainer) {
        if (mapContainer) {
            const t = TerriaViewer.create(this.terriaPreview, {
                mapContainer: mapContainer
            });
            // disable preview map interaction
            const map = t.terria.leaflet.map;
            map.touchZoom.disable();
            map.doubleClickZoom.disable();
            map.scrollWheelZoom.disable();
            map.boxZoom.disable();
            map.keyboard.disable();
            map.dragging.disable();
        }
    },

    render() {
        return (<div className='data-preview-map' onClick={this.clickMap}>
                    <div className='terria-preview' ref={this.mapIsReady}>
                    </div>
                    <label className='label--preview-badge'></label>
                </div>
                );
    }
});
module.exports = DataPreviewMap;
