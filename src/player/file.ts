

import MP4Box from 'mp4box';



//import MP4Box, {MP4File, MP4Info, MP4MediaTrack, MP4ArrayBuffer, MP4Sample, MP4Track} from 'mp4box'
import {DataStream} from 'mp4box'




export function description(mp4, track) {
    const trak = mp4.getTrackById(track.id);

    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
        if (box) {
            const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
            box.write(stream);
            return new Uint8Array(stream.buffer, 8);  // Remove the box header.
        }
    }
    throw new Error("avcC, hvcC, vpcC, or av1C box not found");
}

export function getAudioTrack(mp4, info) {
    if(info.audioTracks.length > 0){
        return info.audioTracks[0];
    }
    return null;
}

export function getVideoTrack(mp4, info) {
    if(info.videoTracks.length > 0){
        return info.videoTracks[0];
    }
    return null;
}

export function getTrackData(mp4, info) {
    const trackData = {
        duration: info.duration/info.timescale,
    };

    if(info.videoTracks.length > 0){
        const videoTrack = info.videoTracks[0];

        trackData.video = {
            codec: videoTrack.codec,
            codedHeight: videoTrack.video.height,
            codedWidth: videoTrack.video.width,
            description: description(mp4, videoTrack),
            frameRate: videoTrack.nb_samples/(videoTrack.samples_duration/videoTrack.timescale)
        }
    }

    const audioTrack = getAudioTrack(mp4, info);

    if(audioTrack){
        let sample_rate;
        let channel_count;

        if(audioTrack.audio){
            const audio = audioTrack.audio;
            if(audio.sample_rate) sample_rate = audio.sample_rate;
            if(audio.channel_count) channel_count = audio.channel_count;
        }

        if(!sample_rate) sample_rate = audioTrack.timescale;
        if(!channel_count) channel_count = 2;

        trackData.audio = {
            codec: audioTrack.codec,
            sampleRate: sample_rate,
            numberOfChannels: channel_count
        }
    }

    return trackData;
}

export function getMoovData(info) {
    // Create an array of stable identifying features
    const stableInfo = {
        ...info,
        created: undefined,
        modified: undefined,
        tracks: info.tracks.map(track => ({
            ...track,
            created: undefined,
            modified: undefined
        })),
        videoTracks: info.videoTracks.map(track => ({
            ...track,
            created: undefined,
            modified: undefined
        })),
        audioTracks: info.audioTracks.map(track => ({
            ...track,
            created: undefined,
            modified: undefined
        }))
    };

    return JSON.stringify(stableInfo);
}

export function getMeta(file) {
    return new Promise(function (resolve, reject){
        const reader = file.stream().getReader();
        let offset = 0;
        const mp4 = MP4Box.createFile(false);
        let ready = false;

        mp4.onReady = async function (info){
            ready = true;
            const trackData = getTrackData(mp4, info);
            resolve({
                info,
                trackData,
                mp4
            });
        }

        mp4.onError = function (err){
            console.log("Error getting meta", err);
            reject(err);
        }

        reader.read().then(async function getNextChunk({done, value}) {
            if (done) {
                return mp4.flush();
            }

            if(ready){
                reader.releaseLock();
                return mp4.flush();
            }

            const copy = value.buffer;
            copy.fileStart = offset;
            offset += value.length;
            mp4.appendBuffer(copy);

            if(offset < file.size){
                return reader.read().then(getNextChunk).catch(function (){
                    console.log("Err")
                });
            } else {
                mp4.flush();

                if(!ready){
                    return reject(new Error("Not a valid mp4 file"));
                }
            }
        })
    });
}

export function extractSegment(file, mp4Data, track, start, end) {
    const {mp4, info, trackData} = mp4Data;

    return new Promise(function (resolve, reject) {
        let offset = 0;
        let finished = false;
        let track_id = 0;

        const EncodedChunk = track === 'audio' ? EncodedAudioChunk : EncodedVideoChunk;
        const chunks = [];

        mp4.onSamples = function (id, user, samples) {
            for (const sample of samples) {
                if (sample.cts / sample.timescale < end) {
                    chunks.push(new EncodedChunk({
                        type: sample.is_sync ? "key" : "delta",
                        timestamp: 1e6 * sample.cts / sample.timescale,
                        duration: 1e6 * sample.duration / sample.timescale,
                        data: sample.data
                    }));
                }
            }

            mp4.releaseUsedSamples(track_id, samples[samples.length-1].number);

            if(chunks.length > 1){
                const lastChunk = chunks[chunks.length - 1];
                if (Math.abs(lastChunk.timestamp / 1e6 - end) < .5 || lastChunk.timestamp / 1e6 > end) {
                    finished = true;
                    mp4.stop();
                    mp4.releaseUsedSamples(track_id, samples[samples.length-1].number);
                    mp4.flush();
                    resolve(chunks);
                }
            }
        }

        for (const trackId in info.tracks){
            const track = info.tracks[trackId];
            mp4.unsetExtractionOptions(track.id);
            mp4.unsetExtractionOptions(track.id);
        }

        const trackToUse = track === 'audio'? getAudioTrack(mp4, info): getVideoTrack(mp4, info);

        if(!trackToUse){
            return resolve([]);
        }

        track_id = trackToUse.id;

        if (!end) end = info.duration / info.timescale - .1; // If you want the whole track, specify start 0, end 0, and then we use the last sample as duration - 0.1 seconds

        end = Math.min(end, info.duration / info.timescale -0.1) // Make sure don't overshoot the video, to prevent forever waiting for new samples that don't exist

        mp4.setExtractionOptions(track_id, null, {nbSamples: 100});

        const seek = mp4.seek(start, true);

        offset = seek.offset;

        const contentReader = file.slice(seek.offset).stream().getReader();

        contentReader.read().then(async function getNextChunk({done, value}) {
            if (done) {
                return mp4.flush();
            }

            if(finished){
                contentReader.releaseLock();
                return mp4.flush()
            }

            const copy = value.buffer;
            copy.fileStart = offset;
            offset += value.length;
            mp4.appendBuffer(copy);
            return contentReader.read().then(getNextChunk).catch(reject);
        })

        mp4.start();

        mp4.onError = function (err) {
            reject(err);
        }
    });
}

let messagePort;
let cached = null;



self.onmessage = async function (event) {
    console.log("Received message", event.data);
    switch (event.data.cmd){
        case "port":
            messagePort = event.data.data;
            messagePort.start(); // This is sometimes needed!
            messagePort.onmessage = async function (event) {
                switch (event.data.cmd){
                    case "test":
                        messagePort.postMessage({cmd: "test-response", data: "test"});
                        break;
                    
                    case "fetch-chunks":
                        try{
                            if(!cached) cached = await getMeta(event.data.data.file);
                            const chunks = await extractSegment(event.data.data.file, cached, event.data.data.type, event.data.data.start, event.data.data.end);
                            messagePort.postMessage({cmd: "fetch-chunks", type: event.data.data.type, data: {chunks, sourceId: event.data.data.sourceId, sceneId: event.data.data.sceneId, startTime: event.data.data.start, endTime: event.data.data.end}});
                        } catch (e) {
                            console.log("Error", e)
                            messagePort.postMessage({ error: e});
                        }
                        break
                }
            };
            break;

        case "check-file-valid":
            try{
                const mp4Data = await getMeta(event.data.data.file);
                postMessage({ request_id: event.data.request_id, res: true});
            } catch (e) {
                postMessage({ request_id: event.data.request_id, res: false});
            }
            break;

        case "get-moov-data":
            try{
                const mp4Data = await getMeta(event.data.data.file);
                const moovData = getMoovData(mp4Data.info);
                postMessage({ request_id: event.data.request_id, res: moovData});
            } catch (e) {
                postMessage({ request_id: event.data.request_id, res: ""});
            }
            break;

        case "get-track-data":
            try{

                console.log("Getting track data")
                const mp4Data = await getMeta(event.data.data.file);
                cached = mp4Data;
                console.log("Track data", mp4Data.trackData);
                postMessage({ request_id: event.data.request_id, res: mp4Data.trackData });
            } catch (e) {
                postMessage({ request_id: event.data.request_id, error: e});
            }
            break

        case "get-track-segment":
            try{
                if(!cached) cached = await getMeta(event.data.data.file);
                const chunks = await extractSegment(event.data.data.file, cached, event.data.data.type, event.data.data.start, event.data.data.end);
                postMessage({ request_id: event.data.request_id, res: chunks});
            } catch (e) {
                console.log("Error", e)
                postMessage({ request_id: event.data.request_id, error: e});
            }
            break
    }
}

