import QrScanner from "https://unpkg.com/qr-scanner/qr-scanner.min.js";

let player; // Will now be a Spotify Web Playback SDK instance
let playbackTimer;
let playbackDuration = 30;
let qrScanner;
let csvCache = {};
let accessToken = null;
const CLIENT_ID = '5199ef6e13344a6baf43586b0e499448'; // Get this from Spotify Developer Dashboard
const REDIRECT_URI = 'http://localhost:8000/callback'; // Updated redirect URI
const SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state'
].join(' '); // Use regular space, URLSearchParams will encode it properly

// Add Spotify SDK script
const spotifyScript = document.createElement('script');
spotifyScript.src = 'https://sdk.scdn.co/spotify-player.js';
document.head.appendChild(spotifyScript);

// Add these utility functions for PKCE
function generateCodeVerifier(length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// Add this function to handle routes
function handleRoutes() {
    const currentPath = window.location.pathname;
    const urlParams = new URLSearchParams(window.location.search);

    if (currentPath === '/callback') {
        if (urlParams.has('code')) {
            const code = urlParams.get('code');
            document.getElementById('loading').style.display = 'block';
            
            getAccessToken(code).then(() => {
                window.history.replaceState({}, document.title, '/');
                document.getElementById('qr-reader').style.display = 'block';
                document.getElementById('cancelScanButton').style.display = 'block';
            }).catch(error => {
                console.error('Authentication error:', error);
                document.getElementById('error-message').textContent = 'Authentication failed. Please try again.';
            }).finally(() => {
                document.getElementById('loading').style.display = 'none';
            });
        } else if (urlParams.has('error')) {
            // Handle authentication errors
            const error = urlParams.get('error');
            console.error('Spotify auth error:', error);
            document.getElementById('error-message').textContent = `Authentication error: ${error}`;
            document.getElementById('loading').style.display = 'none';
        }
    } else if (currentPath !== '/callback') {
        initializeSpotifyAuth();
    }
}

// Modify the existing window.onload or DOMContentLoaded event
document.addEventListener('DOMContentLoaded', () => {
    // Handle routing first
    handleRoutes();
    
    // ... rest of your existing initialization code ...
});

// Update initializeSpotifyAuth to remove the callback handling
async function initializeSpotifyAuth() {
    // Check if we have a stored token that's still valid
    const storedToken = localStorage.getItem('spotify_access_token');
    const tokenExpiry = localStorage.getItem('spotify_token_expiry');
    
    if (storedToken && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
        accessToken = storedToken;
        initializePlayer(storedToken);
    } else {
        // No valid token, start auth process
        await redirectToSpotifyAuth();
    }
}

async function redirectToSpotifyAuth() {
    const codeVerifier = generateCodeVerifier(128);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    
    localStorage.setItem('code_verifier', codeVerifier);
    
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        scope: SCOPES
    });

    window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function getAccessToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier');
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
        }),
    });

    const data = await response.json();
    if (response.ok) {
        accessToken = data.access_token;
        // Store token and expiry
        localStorage.setItem('spotify_access_token', accessToken);
        localStorage.setItem('spotify_token_expiry', Date.now() + (data.expires_in * 1000));
        // Initialize player with the new token
        initializePlayer(accessToken);
    } else {
        console.error('Error getting access token:', data);
        // Handle error appropriately
    }
}

// At the top of your file, add a variable to track player readiness
let isPlayerReady = false;
let deviceId = null;

// Modify the player initialization listener
function initializePlayer(token) {
    player = new Spotify.Player({
        name: 'SongSeeker Player',
        getOAuthToken: cb => { cb(token); }
    });

    player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        isPlayerReady = true;
        deviceId = device_id;
    });

    player.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
    });

    player.addListener('initialization_error', ({ message }) => {
        console.error('Failed to initialize', message);
    });

    player.addListener('authentication_error', ({ message }) => {
        console.error('Failed to authenticate', message);
        // Clear stored tokens and restart auth process
        localStorage.removeItem('spotify_access_token');
        localStorage.removeItem('spotify_token_expiry');
        redirectToSpotifyAuth();
    });

    player.addListener('account_error', ({ message }) => {
        console.error('Failed to validate Spotify account', message);
    });

    player.connect();
}

// Modify the existing onSpotifyWebPlaybackSDKReady
window.onSpotifyWebPlaybackSDKReady = () => {
    // Initialize auth when SDK is ready
    initializeSpotifyAuth();
};

document.addEventListener('DOMContentLoaded', function () {

    let lastDecodedText = ""; // Store the last decoded text

    const video = document.getElementById('qr-video');
    const resultContainer = document.getElementById("qr-reader-results");

    qrScanner = new QrScanner(video, result => {
        console.log('decoded qr code:', result);
        if (result.data !== lastDecodedText) {
            lastDecodedText = result.data; // Update the last decoded text
            handleScannedLink(result.data);
        }
    }, { 
        highlightScanRegion: true,
        highlightCodeOutline: true,
    }
    );
    
    // Function to determine the type of link and act accordingly
    async function handleScannedLink(decodedText) {
        let spotifyURL = "";
        if (isSpotifyLink(decodedText)) {
            spotifyURL = decodedText;
        } else if (isHitsterLink(decodedText)) {
            const hitsterData = parseHitsterUrl(decodedText);
            if (hitsterData) {
                try {
                    const csvContent = await getCachedCsv(`/hitster-${hitsterData.lang}.csv`);
                    const spotifyLink = lookupSpotifyLink(hitsterData.id, csvContent);
                    if (spotifyLink) {
                        console.log(`Spotify Link from CSV: ${spotifyLink}`);
                        spotifyURL = spotifyLink;
                    }
                } catch (error) {
                    console.error("Failed to fetch CSV:", error);
                }
            }
        }

        const spotifyData = parseSpotifyLink(spotifyURL);
        if (spotifyData) {
            currentTrackId = spotifyData.trackId; // Store the track ID
            qrScanner.stop();
            document.getElementById('qr-reader').style.display = 'none';
            document.getElementById('cancelScanButton').style.display = 'none';
            lastDecodedText = "";

            // Remove the automatic playback code
            // The user will need to click the Play button to start playback
            
            // Optional: Update UI to indicate track is ready to play
            document.getElementById('startstop-video').textContent = 'Play';
            document.getElementById('startstop-video').style.display = 'block';
        }
    }

    function isHitsterLink(url) {
        // Regular expression to match with or without "http://" or "https://"
        const regex = /^(?:http:\/\/|https:\/\/)?(www\.hitstergame|app\.hitsternordics)\.com\/.+/;
        return regex.test(url);
    }

    // Example implementation for isYoutubeLink
    function isSpotifyLink(url) {
        return url.startsWith("https://open.spotify.com") || url.startsWith("spotify:");
    }

    // Example implementation for parseHitsterUrl
    function parseHitsterUrl(url) {
        const regex = /^(?:http:\/\/|https:\/\/)?www\.hitstergame\.com\/(.+?)\/(\d+)$/;
        const match = url.match(regex);
        if (match) {
            // Hitster URL is in the format: https://www.hitstergame.com/{lang}/{id}
            // lang can be things like "en", "de", "pt", etc., but also "de/aaaa0007"
            const processedLang = match[1].replace(/\//g, "-");
            return { lang: processedLang, id: match[2] };
        }
        const regex_nordics = /^(?:http:\/\/|https:\/\/)?app.hitster(nordics).com\/resources\/songs\/(\d+)$/;
        const match_nordics = url.match(regex_nordics);
        if (match_nordics) {
            // Hitster URL can also be in the format: https://app.hitsternordics.com/resources/songs/{id}
            return { lang: match_nordics[1], id: match_nordics[2] };
        }
        return null;
    }

    // Looks up the YouTube link in the CSV content based on the ID
    function lookupSpotifyLink(id, csvContent) {
        const headers = csvContent[0]; // Get the headers from the CSV content
        const cardIndex = headers.indexOf('Card#');
        const urlIndex = headers.indexOf('URL');

        const targetId = parseInt(id, 10); // Convert the incoming ID to an integer
        const lines = csvContent.slice(1); // Exclude the first row (headers) from the lines

        if (cardIndex === -1 || urlIndex === -1) {
            throw new Error('Card# or URL column not found');
        }

        for (let row of lines) {
            const csvId = parseInt(row[cardIndex], 10);
            if (csvId === targetId) {
                return row[urlIndex].trim(); // Return the YouTube link
            }
        }
        return null; // If no matching ID is found

    }

    // Could also use external library, but for simplicity, we'll define it here
    function parseCSV(text) {
        const lines = text.split('\n');
        return lines.map(line => {
            const result = [];
            let startValueIdx = 0;
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                if (line[i] === '"' && line[i-1] !== '\\') {
                    inQuotes = !inQuotes;
                } else if (line[i] === ',' && !inQuotes) {
                    result.push(line.substring(startValueIdx, i).trim().replace(/^"(.*)"$/, '$1'));
                    startValueIdx = i + 1;
                }
            }
            result.push(line.substring(startValueIdx).trim().replace(/^"(.*)"$/, '$1')); // Push the last value
            return result;
        });
    }

    async function getCachedCsv(url) {
        if (!csvCache[url]) { // Check if the URL is not in the cache
            console.log(`URL not cached, fetching CSV from URL: ${url}`);
            const response = await fetch(url);
            const data = await response.text();
            csvCache[url] = parseCSV(data); // Cache the parsed CSV data using the URL as a key
        }
        return csvCache[url]; // Return the cached data for the URL
    }

    function parseSpotifyLink(url) {
        const regex = /^(?:https:\/\/open\.spotify\.com\/track\/|spotify:track:)([a-zA-Z0-9]+)(?:\?.*)?$/;
        const match = url.match(regex);
        if (match) {
            const queryParams = new URLSearchParams(url.split('?')[1] || '');
            return {
                trackId: match[1],
                startTime: parseInt(queryParams.get('start') || 0, 10)
            };
        }
        return null;
    }
});

// Assuming you have an element with the ID 'qr-reader' for the QR scanner
document.getElementById('qr-reader').style.display = 'none'; // Initially hide the QR Scanner

document.getElementById('startScanButton').addEventListener('click', function() {
    document.getElementById('cancelScanButton').style.display = 'block';
    document.getElementById('qr-reader').style.display = 'block'; // Show the scanner
    qrScanner.start().catch(err => {
        console.error('Unable to start QR Scanner', err);
        qrResult.textContent = "QR Scanner failed to start.";
    });

    qrScanner.start().then(() => {
        qrScanner.setInversionMode('both'); // we want to scan also for Hitster QR codes which use inverted colors
    });
});

document.getElementById('songinfo').addEventListener('click', function() {
    var cb = document.getElementById('songinfo');
    var videoid = document.getElementById('videoid');
    var videotitle = document.getElementById('videotitle');
    var videoduration = document.getElementById('videoduration');
    if(cb.checked == true){
        videoid.style.display = 'block';
        videotitle.style.display = 'block';
        videoduration.style.display = 'block';
    } else {
        videoid.style.display = 'none';
        videotitle.style.display = 'none';
        videoduration.style.display = 'none';
    }
});

document.getElementById('cancelScanButton').addEventListener('click', function() {
    qrScanner.stop(); // Stop scanning after a result is found
    document.getElementById('qr-reader').style.display = 'none'; // Hide the scanner after successful scan
    document.getElementById('cancelScanButton').style.display = 'none'; // Hide the cancel-button
    document.getElementById('stopButton').style.display = 'none'; // Hide stop button
});
document.getElementById('cb_settings').addEventListener('click', function() {
    var cb = document.getElementById('cb_settings');
    if (cb.checked == true) {
        document.getElementById('settings_div').style.display = 'block';
    }
    else {
        document.getElementById('settings_div').style.display = 'none';
    }
});

document.getElementById('randomplayback').addEventListener('click', function() {
    document.cookie = "RandomPlaybackChecked=" + this.checked + ";max-age=2592000"; //30 Tage
    listCookies();
});

document.getElementById('autoplay').addEventListener('click', function() {
    document.cookie = "autoplayChecked=" + this.checked + ";max-age=2592000"; //30 Tage
    listCookies();
});

document.getElementById('cookies').addEventListener('click', function() {
    var cb = document.getElementById('cookies');
    if (cb.checked == true) {
        document.getElementById('cookielist').style.display = 'block';
    }
    else {
        document.getElementById('cookielist').style.display = 'none';
    }
});

function listCookies() {
    var result = document.cookie;
    document.getElementById("cookielist").innerHTML=result;
 }

function getCookieValue(name) {
    const regex = new RegExp(`(^| )${name}=([^;]+)`);
    const match = document.cookie.match(regex);
    if (match) {
        return match[2];
    }
}

function getCookies() {
    var isTrueSet;
    if (getCookieValue("RandomPlaybackChecked") != "") {
        isTrueSet = (getCookieValue("RandomPlaybackChecked") === 'true');
        document.getElementById('randomplayback').checked = isTrueSet;
    }
    if (getCookieValue("autoplayChecked") != "") {
        isTrueSet = (getCookieValue("autoplayChecked") === 'true');
        document.getElementById('autoplay').checked = isTrueSet;  
    }
    listCookies();
}

window.addEventListener("DOMContentLoaded", getCookies());

// Modify player control functions
function playVideoAtRandomStartTime() {
    // Get current track duration from Spotify SDK
    player.getCurrentState().then(state => {
        if (!state) return;

        const minStartPercentage = 0.10;
        const maxEndPercentage = 0.90;
        const duration = state.duration;
        playbackDuration = parseInt(document.getElementById('playback-duration').value, 10) || 30;

        const minStartTime = duration * minStartPercentage;
        const maxEndTime = duration * maxEndPercentage;
        const startTime = minStartTime + Math.random() * (maxEndTime - minStartTime - playbackDuration);
        const endTime = startTime + playbackDuration;

        player.seek(startTime).then(() => {
            player.resume();
            
            clearTimeout(playbackTimer);
            playbackTimer = setTimeout(() => {
                player.pause();
                document.getElementById('startstop-video').innerHTML = "Play";
            }, playbackDuration * 1000);
        });
    });
}

// Add event listener for stop button
document.getElementById('stopButton').addEventListener('click', async function() {
    try {
        await fetch('https://api.spotify.com/v1/me/player/pause', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
        });
        this.style.display = 'none'; // Hide stop button after stopping
    } catch (error) {
        console.error('Failed to stop playback:', error);
    }
});

// Add this variable at the top of your file to track the current track ID
let currentTrackId = null;

// Add play/pause button functionality
document.getElementById('startstop-video').addEventListener('click', async function() {
    if (!isPlayerReady || !deviceId) {
        console.error('Spotify player not ready');
        return;
    }

    try {
        // Always start fresh with the current track ID when Play is clicked
        if (currentTrackId) {
            await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    uris: [`spotify:track:${currentTrackId}`]
                }),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
            });
            this.textContent = 'Pause';
            document.getElementById('stopButton').style.display = 'block';
            return;
        }

        // Get current playback state (only for pause functionality)
        const state = await player.getCurrentState();
        if (state && !state.paused) {
            // Pause playback
            await fetch('https://api.spotify.com/v1/me/player/pause', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
            });
            this.textContent = 'Play';
            document.getElementById('stopButton').style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to toggle playback:', error);
    }
});

// Update the stop button handler to update the play button text
document.getElementById('stopButton').addEventListener('click', async function() {
    try {
        await fetch('https://api.spotify.com/v1/me/player/pause', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
        });
        this.style.display = 'none';
        document.getElementById('startstop-video').textContent = 'Play'; // Update play button text
    } catch (error) {
        console.error('Failed to stop playback:', error);
    }
});
