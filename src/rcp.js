/**
 * Recent Changes Patrol, v2.0
 *
 * Script to display unpatrolled recent changes directly in the
 * sidebar. This gadget is based on a similarly-named script [1],
 * which had been copied to the Norwegian Bokmål Wikipedia and
 * adapted locally by users Laaknor, Jeblad, Flums and EivindJ.
 *
 * @author Jon Harald Søby
 * @version 2.2.1 (2024-12-27)
 */

const api = new mw.Api();
let intervalId;
let lastCheckedTime = 0;

const messages = function() {
	let translations = require( './rcp-i18n.json' ),
		chain = mw.language.getFallbackLanguageChain(),
		len = chain.length,
		ret = {},
		i = len - 1;
	while ( i >= 0 ) {
		if ( translations.hasOwnProperty( chain[ i ] ) ) {
			Object.assign( ret, translations[ chain[ i ] ] );
		}
		i = i - 1;
	}
	mw.messages.set( ret );
}();

/**
 * Get the configuration for this wiki.
 *
 * @returns {object}
 */
function getConf() {
	const defaultConf = {
		'dangerousTags': [
			'mw-blank',
			'mw-changed-redirect-target',
			'mw-manual-revert',
			'mw-replace',
			'mw-undo'
		],
		'defaultPrefs': {
			'origin': 'recentchanges',
			'quantity': 10,
			'frequency': 60,
			'newOnly': false,
			'namespace': 'all',
			'direction': 'older'
		}
	}
	const conf = require( './rcp-config.json' ) || {};
	Object.assign( defaultConf, conf );
	return defaultConf;
}

/**
 * Get the user's preferences
 *
 * @param {Object} newPrefs
 * @returns {Object}
 */
function getPreferences( newPrefs = {} ) {
	let prefs = {};

	const userPrefs = JSON.parse( mw.user.options.get( 'userjs-rcp' ) ) || {};

	/* No ES2018 in gadgets :-(
	return {
		...defaultPrefs,
		...userPrefs,
		...newPrefs
	}*/
	Object.assign( prefs, getConf().defaultPrefs );
	Object.assign( prefs, userPrefs );
	Object.assign( prefs, newPrefs );
	return prefs;
}

/** Set the user's preferences
 *
 * @param {Object} prefs
 */
function setPreferences( options ) {
	mw.user.options.set( 'userjs-rcp', JSON.stringify( options ) );

	return api.postWithEditToken( {
		action: 'options',
		format: 'json',
		formatversion: 2,
		optionname: 'userjs-rcp',
		optionvalue: JSON.stringify( options )
	} );
}

/**
 * Return the list type we want and its API prefix.
 *
 * @param {string} origin
 * @returns {Object}
 */
function getApiListType( origin ) {
	if ( origin === 'watchlist' ) {
		return {
			list: 'watchlist',
			prefix: 'wl'
		};
	}

	return {
		list: 'recentchanges',
		prefix: 'rc'
	};
}

/**
 * Return an API request for unpatrolled changes.
 *
 * @param {Object} prefs
 * @returns {Object}
 */
function getUnpatrolled( prefs ) {
	const listType = getApiListType( prefs.origin ),
		editType = prefs.newOnly ? 'new' : [ 'edit', 'new' ];

	const request = {
		action: 'query',
		list: listType.list,
		format: 'json',
		formatversion: 2,
		[ listType.prefix + 'show' ]: '!patrolled',
		[ listType.prefix + 'type' ]: editType,
		[ listType.prefix + 'prop' ]: [ 'title', 'timestamp', 'ids', 'sizes', 'tags' ],
		[ listType.prefix + 'dir' ]: prefs.direction,
		[ listType.prefix + 'limit' ]: prefs.quantity,
		maxage: prefs.frequency,
		smaxage: prefs.frequency
	}

	let contentNamespaces = mw.config.get( 'wgContentNamespaces' );

	if ( prefs.namespace === 'content' ) {
		request[ listType.prefix + 'namespace' ] = contentNamespaces;
	} else if ( prefs.namespace === 'noncontent' ) {
		let allNamespaces = Object.values( mw.config.get( 'wgNamespaceIds' ) );
		allNamespaces = [ ...new Set( allNamespaces ) ];

		let nonContentNamespaces = allNamespaces.filter( ns => !contentNamespaces.includes( ns ) );
		request[ listType.prefix + 'namespace' ] = nonContentNamespaces;
	}

	lastCheckedTime = Date.now();

	return api.get( request );
}

/**
 * Create a single portlet link for an unpatrolled change in our portlet.
 *
 * @param {Object} data
 */
function createPortletEntry( data ) {
	const portletLink = mw.util.addPortletLink(
		'p-unpatrolled',
		mw.util.getUrl(
			data.title,
			{
				oldid: 'prev',
				diff: data.revid
			}
		),
		data.title
	);

	const classesToAdd = [ 'userjs-rcp-item' ];

	let sizeDiff = data.newlen - data.oldlen;
	if ( sizeDiff > 0 ) {
		classesToAdd.push( 'userjs-rcp-diff-positive' );
		sizeDiff = '+' + sizeDiff.toString();
	} else if ( sizeDiff < 0 ) {
		classesToAdd.push( 'userjs-rcp-diff-negative' );
		sizeDiff = '−' + Math.abs( sizeDiff ).toString();
	}

	if ( Math.abs( sizeDiff ) >= 500 ) {
		classesToAdd.push( 'userjs-rcp-diff-large' );
	}

	let $itemTitle = $( '<span>' )
		.addClass( 'userjs-rcp-item-title' )
		.attr( 'data-rcp-diffsize', sizeDiff )
		.text( data.title );
	let $timestamp = $( '<span>' )
		.addClass( 'userjs-rcp-timestamp' )
		.text( '(' + moment( data.timestamp ).fromNow() + ')' );

	$( portletLink )
		.find( 'a' )
		.empty()
		.append( $itemTitle );

	if ( data.type === 'new' ) {
		classesToAdd.push( 'userjs-rcp-item-new' );
		$itemTitle.attr(
			'data-rcp-indicator-new',
			mw.msg( 'userjs-rcp-indicator-new' )
		);
	}

	if ( getConf().dangerousTags.filter( tag => data.tags.includes( tag ) ).length ) {
		classesToAdd.push( 'userjs-rcp-item-highlight' );
		$itemTitle.attr(
			'data-rcp-indicator-highlight',
			mw.msg( 'userjs-rcp-indicator-highlight' )
		);
	}

	$( portletLink )
		.addClass( classesToAdd.join( ' ' ) );

	if ( mw.config.get( 'skin' ) === 'minerva' ) {
		$( portletLink )
			.addClass( 'toggle-list-item ' )
			.find( 'a' )
				.addClass( 'toggle-list-item__anchor' )
				.attr( 'title', moment( data.timestamp ).fromNow() )
				.find( 'span' )
					.addClass( 'toggle-list-item__label' );
		$( portletLink )
			.closest( 'ul' )
				.addClass( 'toggle-list__list' );
	} else {
		$( portletLink ).find( 'a' ).append( $timestamp );
	}
}

/**
 * Add portlet links for the changes to the portlet with the list of
 * unpatrolled changes.
 *
 * @param {boolean} initial First time to populate the list?
 */
function populateList( initial = false ) {
	if ( document.hidden ) return;

	const prefs = getPreferences();

	const $list = $( '#p-unpatrolled ul' );
	if ( !initial ) $list.addClass( 'oo-ui-pendingElement-pending' );

	getUnpatrolled( prefs ).done( function( data ) {
		if ( !initial ) {
			$list.empty();
			$list.removeClass( 'oo-ui-pendingElement-pending' );
		}

		const changeListType = getApiListType( prefs.origin ).list,
			changeList = data.query[ changeListType ];

		if ( changeList.length === 0 ) {
			let fakePortletLink = mw.util.addPortletLink(
				'p-unpatrolled',
				'#',
				mw.msg( 'userjs-rcp-portlet-empty' ),
				'n-userjs-rcp-emptylist'
			);
			$( fakePortletLink )
				.find( 'a' )
				.replaceWith(
					$( '<span>' )
						.text( mw.msg( 'userjs-rcp-portlet-empty' ) )
				);
			return;
		}

		for ( let change of changeList ) {
			createPortletEntry( change );
		}
	} ).fail( function( error, errorObj ) {
		console.log( 'Error from Gadget-rcp.js: ' + error, errorObj );
	} );
}

/**
 * Refresh the list of changes.
 */
function refreshList() {
	clearInterval( intervalId );
	populateList();
	intervalId = setInterval( populateList, getPreferences().frequency * 1000 );
}

/**
 * Add the options button to the portlet.
 */
function addOptionsButton() {
	const $optionsButton = $( '<button>' )
			.addClass( 'userjs-rcp-options-button' )
			.attr( 'title', mw.msg( 'userjs-rcp-options' ) )
			.on( 'click', optionsDialog );
	$( '#p-unpatrolled' ).prepend( $optionsButton );
}

/**
 * Handle the options dialog.
 */
function optionsDialog() {
	function EditRcpDialog( config ) {
		EditRcpDialog.super.call( this, config );
	}
	OO.inheritClass( EditRcpDialog, OO.ui.ProcessDialog );

	EditRcpDialog.static.name = 'editRcpDialog';
	EditRcpDialog.static.title = mw.msg( 'userjs-rcp-options' );
	EditRcpDialog.static.actions = [
		{
			action: 'save',
			label: mw.msg( 'userjs-rcp-dialog-save' ),
			flags: [ 'primary', 'progressive' ],
			framed: true
		},
		{
			action: 'reset',
			label: mw.msg( 'userjs-rcp-dialog-reset' ),
			flags: [ 'destructive' ],
			framed: true
		},
		{
			label: mw.msg( 'userjs-rcp-dialog-cancel' ),
			flags: 'safe',
			icon: 'close',
			invisibleLabel: true
		}
	];

	EditRcpDialog.prototype.initialize = function() {
		EditRcpDialog.super.prototype.initialize.apply( this, arguments );

		this.fields = [];
		const prefs = getPreferences();
		const fieldset = new OO.ui.FieldsetLayout();
		let newPrefs = {};

		const options = [
			{
				pref: 'origin',
				widget: new OO.ui.ButtonSelectWidget( {
					items: [
						new OO.ui.ButtonOptionWidget( {
							data: 'recentchanges',
							icon: 'recentChanges',
							label: mw.msg( 'userjs-rcp-options-origin-rc' )
						} ),
						new OO.ui.ButtonOptionWidget( {
							data: 'watchlist',
							icon: 'watchlist',
							label: mw.msg( 'userjs-rcp-options-origin-wl' )
						} )
					]
				} ).selectItemByData( prefs.origin ).on( 'choose', function( item, selected ) {
					if ( selected ) newPrefs.origin = item.getData();
				} ),
				label: 'userjs-rcp-options-origin'
			},
			{
				pref: 'namespace',
				widget: new OO.ui.ButtonSelectWidget( {
					items: [
						new OO.ui.ButtonOptionWidget( {
							data: 'all',
							label: mw.msg( 'userjs-rcp-options-namespace-all' )
						} ),
						new OO.ui.ButtonOptionWidget( {
							data: 'content',
							icon: 'article',
							label: mw.msg( 'userjs-rcp-options-namespace-content' )
						} ),
						new OO.ui.ButtonOptionWidget( {
							data: 'noncontent',
							label: mw.msg( 'userjs-rcp-options-namespace-noncontent' )
						} )
					]
				} ).selectItemByData( prefs.namespace ).on( 'choose', function( item, selected ) {
					if ( selected ) newPrefs.namespace = item.getData();
				} ),
				label: 'userjs-rcp-options-namespace'
			},
			{
				pref: 'direction',
				widget: new OO.ui.ButtonSelectWidget( {
					items: [
						new OO.ui.ButtonOptionWidget( {
							data: 'older',
							label: mw.msg( 'userjs-rcp-options-direction-newest' )
						} ),
						new OO.ui.ButtonOptionWidget( {
							data: 'newer',
							label: mw.msg( 'userjs-rcp-options-direction-oldest' )
						} )
					]
				} ).selectItemByData( prefs.direction ).on( 'choose', function( item, selected ) {
					if ( selected ) newPrefs.direction = item.getData();
				} ),
				label: 'userjs-rcp-options-direction'
			},
			{
				pref: 'newOnly',
				widget: new OO.ui.CheckboxInputWidget( {
					selected: prefs.newOnly
				} ).on( 'change', function( selected, indeterminate ) {
					if ( selected ) newPrefs.newOnly = true;
				} ),
				label: 'userjs-rcp-options-newonly',
				align: 'inline'
			},
			{
				pref: 'quantity',
				widget: new OO.ui.NumberInputWidget( {
					min: 1,
					max: 20,
					step: 1,
					value: prefs.quantity
				} ).on( 'change', function( value ) {
					if ( value >= 1 && value <= 20 ) newPrefs.quantity = value;
				} ),
				label: 'userjs-rcp-options-quantity'
			},
			{
				pref: 'frequency',
				widget: new OO.ui.NumberInputWidget( {
					min: 30,
					max: 600,
					buttonStep: 10,
					value: prefs.frequency
				} ).on( 'change', function( value ) {
					if ( value >= 30 && value <= 600 ) newPrefs.frequency = value;
				} ),
				label: 'userjs-rcp-options-frequency',
				help: 'userjs-rcp-options-frequency-between'
			}
		];

		for ( const option of options ) {
			const field = new OO.ui.FieldLayout( option.widget, {
				label: mw.msg( option.label ),
				align: option.align ? option.align : 'top',
				help: option.help ? mw.msg( option.help ) : '',
				helpInline: true
			} );
			this.fields.push( option );
			fieldset.addItems( [ field ] );
		}

		this.newPrefs = newPrefs;
		this.content = new OO.ui.PanelLayout( { padded: true, expanded: false, $content: fieldset.$element } );
		this.$body.append( this.content.$element );
	};

	EditRcpDialog.prototype.getActionProcess = function( action ) {
		const dialog = this;
		if ( action === 'save' || action === 'reset' ) {
			dialog.pushPending();
			let newoptions = getPreferences( dialog.newPrefs );

			if ( action === 'reset' ) newoptions = {};

			setPreferences( newoptions ).then( function() {
				dialog.close();
				refreshList();
			} ).fail( function() {
				mw.notify( mw.msg( 'userjs-rcp-error' ), { type: 'error' } );
			} );
		}
		return EditRcpDialog.super.prototype.getActionProcess.call( this, action );
	};

	const windowManager = new OO.ui.WindowManager();
	$( document.body ).append( windowManager.$element );

	const dialog = new EditRcpDialog();
	windowManager.addWindows( [ dialog ] );
	windowManager.openWindow( dialog );
}

const portlet = mw.util.addPortlet(
	'p-unpatrolled',
	mw.msg( 'userjs-rcp-portlet-title' ),
	'#p-navigation'
);

addOptionsButton();
populateList( true );
intervalId = setInterval( populateList, getPreferences().frequency * 1000 );

window.addEventListener( 'visibilitychange', ( event ) => {
	if ( document.hidden ) return;

	if ( Date.now() - lastCheckedTime > getPreferences().frequency * 1000 ) {
		refreshList();
	}
} );
