on run argv
	set inPath to item 1 of argv
	set outPath to item 2 of argv

	-- Address documents by file name. `active document` is a race: when Word already has a file
	-- open, that file can still be the active one here, and the export then writes the wrong
	-- document out under the letter's filename with no error at all. That happened once, and a CV
	-- was exported as a cover letter. Word's `open` returns nothing to bind, so the name is the
	-- only reliable handle.
	set AppleScript's text item delimiters to "/"
	set docName to last text item of inPath
	set pdfName to last text item of outPath
	set AppleScript's text item delimiters to ""

	tell application "Microsoft Word"
		set wasRunning to running
		activate
		open inPath
		save as document docName file name outPath file format format PDF

		-- After `save as`, the open document may be tracked under the PDF's name instead of the
		-- .docx's, so the original reference goes stale and `close` fails. Closing errors are not
		-- worth failing the build over: the PDF is already written by this point, and an
		-- unhandled error here aborts the caller before it can run its one-page check, and leaves
		-- a `~$` lock file behind.
		try
			close document pdfName saving no
		end try
		try
			close document docName saving no
		end try

		if not wasRunning then quit
	end tell
	return outPath
end run
