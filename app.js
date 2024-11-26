import QrScanner from "https://unpkg.com/qr-scanner/qr-scanner.min.js";

let player; // Will now be a Spotify Web Playback SDK instance
let playbackTimer;
let playbackDuration = 30;
let qrScanner;
let csvCache = {};
let accessToken = null;
const CLIENT_ID = '5199ef6e13344a6baf43586b0e499448'; // Get this from Spotify Developer Dashboard
const REDIRECT_URI = window.location.hostname === 'localhost' 
    ? 'http://localhost:8000/callback'
    : `${window.location.origin}/callback`; // Updated redirect URI
const SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state'
].join(' '); // Use regular space, URLSearchParams will encode it properly

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
            const loadingElement = document.getElementById('loading');
            const errorElement = document.getElementById('error-message');
            
            if (loadingElement) {
                loadingElement.style.display = 'block';
            }
            
            getAccessToken(code).then(() => {
                // After successful token retrieval, redirect to home
                window.history.replaceState({}, document.title, '/');
            }).catch(error => {
                console.error('Authentication error:', error);
                if (errorElement) {
                    errorElement.textContent = 'Authentication failed. Please try again.';
                }
            }).finally(() => {
                if (loadingElement) {
                    loadingElement.style.display = 'none';
                }
            });
        } else if (urlParams.has('error')) {
            console.error('Auth error:', urlParams.get('error'));
        }
    }
}

// Add this at the start of your file to handle the callback route
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the callback route
    if (window.location.pathname === '/callback') {
        handleRoutes();
    }
});

// Update initializeSpotifyAuth to avoid redundant auth
async function initializeSpotifyAuth() {
    const storedToken = localStorage.getItem('spotify_access_token');
    const tokenExpiry = localStorage.getItem('spotify_token_expiry');
    const isTokenValid = storedToken && tokenExpiry && Date.now() < parseInt(tokenExpiry);
    
    console.log('InitializeSpotifyAuth - Token status:', {
        hasStoredToken: !!storedToken,
        hasTokenExpiry: !!tokenExpiry,
        isTokenValid,
        currentTime: Date.now(),
        expiryTime: parseInt(tokenExpiry)
    });

    if (isTokenValid) {
        console.log('Using existing valid token in initializeSpotifyAuth');
        accessToken = storedToken;
        if (!isPlayerReady) {
            await initializePlayer(storedToken);
        }
        return;
    }
    
    console.log('No valid token, redirecting to Spotify auth');
    await redirectToSpotifyAuth();
}

async function redirectToSpotifyAuth() {
    const codeVerifier = generateCodeVerifier(128);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    
    // Store code verifier in localStorage for later use
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

// Update getAccessToken to log more details
async function getAccessToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier');
    
    if (!codeVerifier) {
        console.error('No code verifier found in localStorage');
        throw new Error('No code verifier found');
    }
    
    try {
        console.log('Requesting access token with:', {
            code,
            codeVerifier: codeVerifier.substring(0, 5) + '...',
            redirect_uri: REDIRECT_URI
        });

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
        console.log('Token response:', {
            ok: response.ok,
            status: response.status,
            error: data.error,
        });

        if (response.ok) {
            accessToken = data.access_token;
            const expiryTime = Date.now() + (data.expires_in * 1000);
            
            console.log('Storing new token with expiry:', {
                tokenPrefix: accessToken.substring(0, 5) + '...',
                expiryTime: new Date(expiryTime).toISOString(),
                expiresIn: data.expires_in
            });
            
            // Store token and expiry
            localStorage.setItem('spotify_access_token', accessToken);
            localStorage.setItem('spotify_token_expiry', expiryTime.toString());
            localStorage.removeItem('code_verifier'); // Clean up
            
            return true;
        } else {
            throw new Error(data.error || 'Failed to get access token');
        }
    } catch (error) {
        console.error('Error getting access token:', error);
        // Clear all auth-related storage on error
        localStorage.removeItem('spotify_access_token');
        localStorage.removeItem('spotify_token_expiry');
        localStorage.removeItem('code_verifier');
        throw error;
    }
}

// Add this variable at the top of your file to track player readiness
let isPlayerReady = false;
let deviceId = null;

// Modify the start button event listener
document.getElementById('startScanButton').addEventListener('click', async function() {
    try {
        // Check if we have a valid token first
        const storedToken = localStorage.getItem('spotify_access_token');
        const tokenExpiry = localStorage.getItem('spotify_token_expiry');
        const isTokenValid = storedToken && tokenExpiry && Date.now() < parseInt(tokenExpiry);
        
        console.log('Token status:', {
            hasStoredToken: !!storedToken,
            hasTokenExpiry: !!tokenExpiry,
            isTokenValid,
            currentTime: Date.now(),
            expiryTime: parseInt(tokenExpiry)
        });

        if (!isTokenValid) {
            console.log('Token is invalid or missing, starting authentication...');
            // Only load SDK and authenticate if we don't have a valid token
            if (!window.Spotify) {
                await loadSpotifySDK();
            }
            await initializeSpotifyAuth();
        } else {
            console.log('Using existing valid token');
            // Make sure SDK is loaded even with valid token
            if (!window.Spotify) {
                await loadSpotifySDK();
            }
            // Set the global accessToken if it's not already set
            accessToken = storedToken;
            // Initialize player if needed
            if (!isPlayerReady) {
                await initializePlayer(storedToken);
            }
        }

        // Hide play button and show scanner
        document.getElementById('player-container').style.display = 'none';
        document.getElementById('cancelScanButton').style.display = 'block';
        document.getElementById('qr-reader').style.display = 'block';
        await qrScanner.start();
        qrScanner.setInversionMode('both');
    } catch (err) {
        console.error('Failed to start:', err);
        document.getElementById('error-message').textContent = "Failed to start scanner or authenticate.";
    }
});

// Update initializePlayer to track readiness
function initializePlayer(token) {
    return new Promise((resolve, reject) => {
        if (isPlayerReady) {
            console.log('Player already initialized');
            resolve();
            return;
        }

        player = new Spotify.Player({
            name: 'SongSeeker Player',
            getOAuthToken: cb => { cb(token); }
        });

        player.addListener('ready', ({ device_id }) => {
            console.log('Ready with Device ID', device_id);
            isPlayerReady = true;
            deviceId = device_id;
            resolve();
        });

        player.addListener('not_ready', ({ device_id }) => {
            console.log('Device ID has gone offline', device_id);
            isPlayerReady = false;
            deviceId = null;
        });

        player.addListener('initialization_error', ({ message }) => {
            console.error('Failed to initialize', message);
            reject(new Error(message));
        });

        player.addListener('authentication_error', ({ message }) => {
            console.error('Failed to authenticate', message);
            isPlayerReady = false;
            deviceId = null;
            // Clear stored tokens and restart auth process
            localStorage.removeItem('spotify_access_token');
            localStorage.removeItem('spotify_token_expiry');
            reject(new Error(message));
        });

        player.connect();
    });
}

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
            currentTrackId = spotifyData.trackId;
            qrScanner.stop();
            
            // Hide scanner and show play button
            document.getElementById('qr-reader').style.display = 'none';
            document.getElementById('cancelScanButton').style.display = 'none';
            document.getElementById('player-container').style.display = 'block';
            
            lastDecodedText = "";

            // Update play button
            const startStopButton = document.getElementById('startstop-video');
            if (startStopButton) {
                startStopButton.innerHTML = '<i class="fas fa-play"></i>';
            }
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

// Add a function to load the Spotify SDK when needed
function loadSpotifySDK() {
    return new Promise((resolve, reject) => {
        // First define the callback that SDK will look for
        window.onSpotifyWebPlaybackSDKReady = () => {
            console.log('Spotify SDK Ready');
            resolve();
        };

        // Then load the SDK script
        const spotifyScript = document.createElement('script');
        spotifyScript.src = 'https://sdk.scdn.co/spotify-player.js';
        spotifyScript.onerror = reject;
        document.head.appendChild(spotifyScript);
    });
}

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
    qrScanner.stop();
    document.getElementById('qr-reader').style.display = 'none';
    document.getElementById('cancelScanButton').style.display = 'none';
    document.getElementById('player-container').style.display = 'block'; // Show play button again
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
    player.getCurrentState().then(state => {
        if (!state) {
            console.error('No playback state available');
            return;
        }

        const duration = state.duration;
        playbackDuration = parseInt(document.getElementById('playback-duration').value, 10) || 30;

        // Calculate random start time between 10% and 90% of the song
        const minStartTime = duration * 0.1;
        const maxStartTime = duration * 0.9 - playbackDuration * 1000; // Convert playbackDuration to milliseconds
        const startTime = Math.floor(minStartTime + Math.random() * (maxStartTime - minStartTime));

        console.log('Playing at random time:', {
            duration,
            startTime,
            playbackDuration
        });

        player.seek(startTime).then(() => {
            player.resume();
            
            // Set timer to stop playback
            clearTimeout(playbackTimer);
            playbackTimer = setTimeout(() => {
                player.pause();
                const playButton = document.getElementById('startstop-video');
                if (playButton) {
                    playButton.innerHTML = '<i class="fas fa-play"></i>';
                }
            }, playbackDuration * 1000);
        });
    });
}

// Add this function to check if token is valid
async function checkAndRefreshToken() {
    const tokenExpiry = localStorage.getItem('spotify_token_expiry');
    const currentTime = Date.now();
    
    // If token is expired or will expire in next 60 seconds
    if (!tokenExpiry || currentTime >= parseInt(tokenExpiry) - 60000) {
        console.log('Token expired or about to expire, refreshing...');
        await initializeSpotifyAuth();
        return true;
    }
    return false;
}

// Update the play/pause/stop button functionality
document.getElementById('startstop-video').addEventListener('click', async function() {
    if (!isPlayerReady || !deviceId) {
        console.error('Spotify player not ready', { isPlayerReady, deviceId });
        return;
    }

    try {
        // Check token validity before making API calls
        const tokenRefreshed = await checkAndRefreshToken();
        if (tokenRefreshed) {
            console.log('Token refreshed, updating headers');
        }

        const state = await player.getCurrentState();
        console.log('Current playback state:', state);

        if (state && !state.paused) {
            // If music is playing, stop it
            await player.pause();
            try {
                // Clear the playback but keep the track ID
                await fetch(`https://api.spotify.com/v1/me/player/pause`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                });
            } catch (error) {
                console.warn('Error while pausing via API:', error);
                // Continue even if this fails
            }
            this.innerHTML = '<i class="fas fa-play"></i>';
        } else {
            // If music is stopped and we have a track, play it
            if (currentTrackId) {
                console.log('Starting playback for track:', currentTrackId);
                
                // Set the active device first
                await fetch(`https://api.spotify.com/v1/me/player`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        device_ids: [deviceId],
                        play: false
                    }),
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                });

                // Small delay to ensure device is active
                await new Promise(resolve => setTimeout(resolve, 300));

                // Start playback
                const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        uris: [`spotify:track:${currentTrackId}`],
                        position_ms: 0
                    }),
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`Spotify API error: ${errorData.error?.message || response.statusText}`);
                }

                // Check if random playback is enabled
                const randomPlayback = document.getElementById('randomplayback');
                if (randomPlayback && randomPlayback.checked) {
                    await playVideoAtRandomStartTime();
                } else {
                    await player.resume();
                }

                this.innerHTML = '<i class="fas fa-stop"></i>';
            }
        }
    } catch (error) {
        console.error('Failed to toggle playback:', error);
        const errorElement = document.getElementById('error-message');
        if (errorElement) {
            errorElement.textContent = `Playback error: ${error.message}`;
            // Auto-hide error after 5 seconds
            setTimeout(() => {
                errorElement.textContent = '';
            }, 5000);
        }
        
        // If we get a 403 error, try to re-authenticate
        if (error.message.includes('403')) {
            console.log('Attempting to re-authenticate...');
            await initializeSpotifyAuth();
        }
    }
});

// Add this variable at the top of your file to track the current track ID
let currentTrackId = null;

// Add debug mode toggle
document.addEventListener('keydown', function(event) {
    // Toggle debug mode when pressing Ctrl+D or Cmd+D
    if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
        event.preventDefault();
        document.body.classList.toggle('debug-mode');
    }
});

// Add this function to create stars
function createStars() {
    const numberOfStars = 50; // Adjust number of stars
    const container = document.body;
    
    for (let i = 0; i < numberOfStars; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.innerHTML = '★';
        
        // Random position
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        
        // Random size
        const size = Math.random() * 15 + 10; // Between 10px and 25px
        
        // Random animation delay
        const delay = Math.random() * 2;
        
        star.style.cssText = `
            left: ${x}vw;
            top: ${y}vh;
            font-size: ${size}px;
            animation-delay: ${delay}s;
        `;
        
        container.appendChild(star);
    }
}

// Call createStars when the document is loaded
document.addEventListener('DOMContentLoaded', function() {
    createStars();
    // ... rest of your existing DOMContentLoaded code ...
});
