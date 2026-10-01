/*
 * Headless QUnit runner for test/index.html.
 *
 * Usage: node build/run-browser-tests.js <url>
 *
 * Requires Node >= 16 and puppeteer (resolved via NODE_PATH); see
 * build/run-browser-tests.sh. Exits 0 when every assertion passed, 1 when any
 * assertion failed, 2 on timeout or runner error.
 */
"use strict";

const puppeteer = require( "puppeteer-core" );

const url = process.argv[ 2 ];
const OVERALL_TIMEOUT_MS = 30 * 60 * 1000;

if ( !url ) {
	console.error( "Usage: node build/run-browser-tests.js <url>" );
	process.exit( 2 );
}

const tests = [];
const moduleTally = new Map();
let pendingFailures = [];
let lastTest = null;

function onLog( entry ) {
	pendingFailures.push( entry );
}

function onTestDone( d ) {
	const failures = pendingFailures;
	pendingFailures = [];
	lastTest = d;
	tests.push( d );

	const mod = d.module || "(no module)";
	const tally = moduleTally.get( mod ) || { passed: 0, total: 0 };
	tally.total++;
	if ( d.failed === 0 ) {
		tally.passed++;
	}
	moduleTally.set( mod, tally );

	if ( d.failed === 0 ) {
		console.log( "PASS [" + mod + "] " + d.name + " (" + d.passed + "/" + d.total + ")" );
	} else {
		console.log( "FAIL [" + mod + "] " + d.name + " (" + d.failed + " of " + d.total +
			" assertions)" );
		failures.forEach( function( f ) {
			console.log( "    - " + ( f.message || "(no message)" ) );
			if ( f.expected !== undefined ) {
				console.log( "      expected: " + f.expected );
			}
			if ( f.actual !== undefined ) {
				console.log( "      actual:   " + f.actual );
			}
			if ( f.source ) {
				console.log( "      source:   " + String( f.source ).split( "\n" ).join( "\n                " ) );
			}
		} );
	}
}

// Installed in every document before any page script runs.
function installHooks() {
	// Only the top-level test page reports; iframes used by individual tests
	// must not register callbacks.
	if ( window !== window.top ) {
		return;
	}

	var stored;
	var hooked = false;

	function safe( value ) {
		var s;
		try {
			s = JSON.stringify( value );
			if ( s === undefined ) {
				s = String( value );
			}
		} catch ( e ) {
			try {
				s = String( value );
			} catch ( e2 ) {
				s = "[unserializable]";
			}
		}
		if ( s.length > 300 ) {
			s = s.slice( 0, 300 ) + "...";
		}
		return s;
	}

	function hook( Q ) {
		if ( hooked || !Q || typeof Q.log !== "function" ) {
			return;
		}
		hooked = true;

		Q.log( function( d ) {
			if ( d.result ) {
				return;
			}
			window.__qLog( {
				module: d.module,
				name: d.name,
				message: d.message === undefined ? undefined : String( d.message ),
				actual: d.actual === undefined ? undefined : safe( d.actual ),
				expected: d.expected === undefined ? undefined : safe( d.expected ),
				source: d.source === undefined ? undefined : String( d.source )
			} );
		} );

		Q.testDone( function( d ) {
			window.__qTestDone( {
				module: d.module,
				name: d.name,
				failed: d.failed,
				passed: d.passed,
				total: d.total
			} );
		} );

		Q.done( function( d ) {
			window.__qDone( {
				failed: d.failed,
				passed: d.passed,
				total: d.total,
				runtime: d.runtime
			} );
		} );
	}

	Object.defineProperty( window, "QUnit", {
		configurable: true,
		enumerable: true,
		get: function() {
			return stored;
		},
		set: function( value ) {
			stored = value;
			hook( value );
		}
	} );
}

function printSummary( done ) {
	console.log( "" );
	console.log( "===== Per-module tally =====" );
	moduleTally.forEach( function( t, mod ) {
		console.log( mod + ": " + t.passed + "/" + t.total );
	} );

	const passedTests = tests.filter( function( t ) {
		return t.failed === 0;
	} ).length;

	console.log( "" );
	console.log( "===== QUnit summary =====" );
	console.log( "Tests: " + tests.length + " total, " + passedTests + " passed, " +
		( tests.length - passedTests ) + " failed" );
	console.log( "Assertions: " + done.total + " total, " + done.passed + " passed, " +
		done.failed + " failed" );
	console.log( "Runtime: " + done.runtime + " ms" );
}

async function main() {
	const browser = await puppeteer.launch( {
		headless: "new",
		executablePath: process.env.CHROME_BIN,
		args: [ "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage" ]
	} );

	let exitCode = 2;
	try {
		const page = await browser.newPage();

		page.on( "console", function( msg ) {
			if ( msg.type() === "error" ) {
				console.log( "[browser] console.error: " + msg.text() );
			}
		} );
		page.on( "pageerror", function( err ) {
			console.log( "[browser] pageerror: " + ( err && err.message ? err.message : err ) );
		} );

		let resolveDone;
		const donePromise = new Promise( function( resolve ) {
			resolveDone = resolve;
		} );

		await page.exposeFunction( "__qLog", onLog );
		await page.exposeFunction( "__qTestDone", onTestDone );
		await page.exposeFunction( "__qDone", function( d ) {
			resolveDone( d );
		} );
		await page.evaluateOnNewDocument( installHooks );

		console.log( "Opening " + url );
		await page.goto( url, { waitUntil: "load", timeout: 120000 } );

		let timer;
		const timeoutPromise = new Promise( function( resolve ) {
			timer = setTimeout( function() {
				resolve( null );
			}, OVERALL_TIMEOUT_MS );
		} );

		const done = await Promise.race( [ donePromise, timeoutPromise ] );
		clearTimeout( timer );

		if ( !done ) {
			console.log( "TIMEOUT: QUnit did not finish within " + ( OVERALL_TIMEOUT_MS / 60000 ) +
				" minutes." );
			console.log( "Last test seen: " + ( lastTest ?
				"[" + lastTest.module + "] " + lastTest.name :
				"(none)" ) );
			console.log( "Tests completed so far: " + tests.length );
			exitCode = 2;
		} else {
			printSummary( done );
			exitCode = done.failed > 0 ? 1 : 0;
		}
	} finally {
		await browser.close().catch( function() {} );
	}
	return exitCode;
}

main().then( function( code ) {
	process.exit( code );
}, function( err ) {
	console.error( "Runner error: " + ( err && err.stack ? err.stack : err ) );
	process.exit( 2 );
} );
