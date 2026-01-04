import { GPUFrameRenderer } from 'webcodecs-utils';

export interface VideoTrackData {
    codec: string,
    codedHeight: number,
    codedWidth: number,
    description: Uint8Array,
    frameRate: number
  }


export default class VideoRenderer {

    lastRenderedTime: number = 0;
    currentChunk: number = 0;
    firstRendered: boolean = false;
    source_buffer: EncodedVideoChunk[] = [];
    rendered_buffer: VideoFrame[] = [];
    canvas: OffscreenCanvas;
    renderer: GPUFrameRenderer;
    decoder: VideoDecoder;
    metadata: VideoTrackData;
    initP: Promise<void>
    constructor(metadata: VideoTrackData, chunks: EncodedVideoChunk[],  canvas: OffscreenCanvas) {


        console.log(chunks[0])

        this.currentChunk =0;
        this.firstRendered = false;

        this.source_buffer = chunks;
        this.rendered_buffer = [];

        this.metadata = metadata;


        this.canvas = canvas;

        // Initialize GPU renderer with linear filtering (hardware accelerated)
        this.renderer = new GPUFrameRenderer(this.canvas, { filterMode: 'linear' });
        this.initP = this.renderer.init();

        this.decoder = this.setupDecoder(metadata)

        this.lastRenderedTime = 0;



        this.fillBuffer();
    }

    setupDecoder(metadata: VideoTrackData){


        const decoder = new VideoDecoder({
            output: function (this: VideoRenderer, frame: VideoFrame){


                if(!this.firstRendered) {
                    this.firstRendered = true;
         
                    this.renderFrame(frame)
                } else {
          
                    if(frame.timestamp/1e6 < this.lastRenderedTime) {
                        frame.close();
                        if(this.rendered_buffer.length < 10) {
                            this.fillBuffer();
                        }
                        return;
                    }
                    this.rendered_buffer.push(frame)
                }

         
        
            }.bind(this),

            error: function (this: VideoRenderer, error: Error){
                console.warn(error);
            }.bind(this)
        },

        )

        decoder.configure(metadata);

        return decoder;

    }

    play(){

    }
    async seek(time: number){

    


        for(let i=0; i < this.rendered_buffer.length; i++){
            this.rendered_buffer[i].close()
        }
        this.rendered_buffer = [];

        let lastKeyFrame = 0;

        for(let i=0; i< this.source_buffer.length; i++){
            if(this.source_buffer[i].type === "key" && this.source_buffer[i].timestamp < time*1e6) lastKeyFrame = i
        }

        let renderTill =lastKeyFrame;
        for(let i=lastKeyFrame; i< this.source_buffer.length; i++){
            if(this.source_buffer[i].timestamp < time*1e6) renderTill = i
        }

        for (let i=lastKeyFrame; i< renderTill; i++){
            this.decoder.decode(this.source_buffer[i]);
        }




        this.currentChunk = renderTill;

    }

    getLatestFrame(time: number){


        for (let i=0; i < this.rendered_buffer.length-1; i++){

            if(this.rendered_buffer[i+1].timestamp < this.rendered_buffer[i].timestamp){
                return i+1;
            }
        }

        if(this.rendered_buffer[0].timestamp/1e6 > time) return -1;

        let latest_frame_buffer_index = 0;

        for (let i=0; i < this.rendered_buffer.length; i++){

            if (this.rendered_buffer[i].timestamp/1000 < time &&  this.rendered_buffer[i].timestamp > this.rendered_buffer[latest_frame_buffer_index].timestamp){
                latest_frame_buffer_index = i
            }
        }

        return latest_frame_buffer_index;



    }
    render(time: number){


        this.lastRenderedTime = time;

        if(this.rendered_buffer.length > 0){

            const latest_frame = this.getLatestFrame(time);


            if(latest_frame > -1){

                for(let i=0; i < latest_frame-1; i++){
                    this.rendered_buffer[i].close()
                }
                this.rendered_buffer.splice(0, latest_frame-1); //Drop frames

                const frame_to_render = this.rendered_buffer.shift();

                this.renderFrame(frame_to_render);
                if(this.rendered_buffer.length < 5) this.fillBuffer();
            }



        }

    }

    fillBuffer(){

        for(let i=0; i < 10; i++){
            if(this.currentChunk +i < this.source_buffer.length){
                try{

           

                    if (this.decoder.state  !== 'configured') {

                        console.log("resetting decoder")
            
             
                        this.decoder = this.setupDecoder(this.metadata);

                        for(let j=this.currentChunk; j < this.source_buffer.length; j++){
                            if(this.source_buffer[j].type === "key"){
                                this.currentChunk = j;
                                break;
                            }
                        }
                    }
                    this.decoder.decode(this.source_buffer[this.currentChunk]);
                    this.currentChunk +=1
                } catch (e) {
                    console.log(e);
                }
            }
        }

    }

  async renderFrame(frame: VideoFrame){


        await this.initP;

        try{

            if(frame.timestamp < this.lastRenderedTime) {
                frame.close();
                return;
            }

            // Use GPU renderer for zero-copy rendering
            this.renderer.drawImage(frame);
            frame.close();

        } catch (e) {
            console.log(e);
        }

    }






}
