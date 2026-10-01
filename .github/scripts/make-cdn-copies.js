/*
 * Generates dist/cdn release copies from the built dist/ files.
 *
 * This mirrors build/release.js makeReleaseCopies(), which the jquery release
 * tool ran before `npm publish` (dist/cdn ships in the public npm tarball).
 * It is a standalone, dependency-free (fs only) ES5 script so it runs on
 * Node 0.10 without the release tooling. Non-prerelease semantics: every
 * releaseFiles entry, including the jquery-latest copies, is written.
 *
 * Usage: node build/make-cdn-copies.js   (from the repository root)
 */
var fs = require( "fs" );

var version = JSON.parse( fs.readFileSync( "package.json", "utf8" ) ).version,

	devFile = "dist/jquery.js",
	minFile = "dist/jquery.min.js",
	mapFile = "dist/jquery.min.map",

	cdnFolder = "dist/cdn",

	releaseFiles = {
		"jquery-VER.js": devFile,
		"jquery-VER.min.js": minFile,
		"jquery-VER.min.map": mapFile,
		"jquery.js": devFile,
		"jquery.min.js": minFile,
		"jquery.min.map": mapFile,
		"jquery-latest.js": devFile,
		"jquery-latest.min.js": minFile,
		"jquery-latest.min.map": mapFile
	};

if ( !fs.existsSync( cdnFolder ) ) {
	fs.mkdirSync( cdnFolder );
}

Object.keys( releaseFiles ).forEach(function( key ) {
	var text,
		builtFile = releaseFiles[ key ],
		unpathedFile = key.replace( /VER/g, version ),
		releaseFile = cdnFolder + "/" + unpathedFile;

	if ( /\.map$/.test( releaseFile ) ) {
		// Map files need to reference the new uncompressed name;
		// assume that all files reside in the same directory.
		// "file":"jquery.min.js","sources":["jquery.js"]
		text = fs.readFileSync( builtFile, "utf8" )
			.replace( /"file":"([^"]+)","sources":\["([^"]+)"\]/,
				"\"file\":\"" + unpathedFile.replace( /\.min\.map/, ".min.js" ) +
				"\",\"sources\":[\"" + unpathedFile.replace( /\.min\.map/, ".js" ) + "\"]" );
		fs.writeFileSync( releaseFile, text );
	} else if ( /\.min\.js$/.test( releaseFile ) ) {
		// Remove the source map comment; it causes way too many problems.
		// Keep the map file in case DevTools allow manual association.
		text = fs.readFileSync( builtFile, "utf8" )
			.replace( /\/\/# sourceMappingURL=\S+/, "" );
		fs.writeFileSync( releaseFile, text );
	} else {
		// Verbatim copy (shell.cp -f in release.js)
		fs.writeFileSync( releaseFile, fs.readFileSync( builtFile ) );
	}

	console.log( "Wrote " + releaseFile );
});
