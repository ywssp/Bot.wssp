const { Command } = require('discord-akairo');
const ytdl = require('ytdl-core');
const createEmbed = require('../../Functions/EmbedCreator.js');
const Youtube = require('simple-youtube-api');
const youtube = new Youtube(process.env.YOUTUBE);
const formatDuration = require('../../Functions/FormatDuration.js');

class PlayCommand extends Command {
  constructor() {
    super('play', {
      aliases: ['play'],
      category: 'Music',
    });
  }
  *args() {
    const searchTerm = yield {
      type: 'string',
      prompt: {
        start: (message) =>
          createEmbed(message, {
            title: 'Search',
            description: 'Enter a search term or a youtube link',
            fields: [
              {
                name: 'Example',
                value:
                  '```Search term\nhttps://youtu.be/bbJkJ8T6ZBQ```',
              },
            ],
            authorBool: true,
          }),
      },
    };
    return { searchTerm };
  }
  async exec(message, args) {
    function playSong(queue, _message) {
      queue[0].voiceChannel
        .join()
        .then(function (connection) {
          const dispatcher = connection
            .play(
              ytdl(queue[0].url, {
                quality: 'highestaudio',
                highWaterMark: 1024 * 1024 * 10,
              }),
            )
            .on('start', async function () {
              message.guild.musicData.songDispatcher = dispatcher;
              dispatcher.setVolume(message.guild.musicData.volume);
              const videoEmbed = await createEmbed(_message, {
                color: 'defaultBlue',
                title: 'Now playing:',
                fields: [
                  {
                    name: 'Title',
                    value: queue[0].title,
                  },
                  {
                    name: 'Length',
                    value: queue[0].duration,
                  },
                  {
                    name: 'URL',
                    value: queue[0].url,
                  },
                  {
                    name: 'Requester',
                    value: queue[0].requester,
                  },
                ],
                thumbnail: queue[0].thumbnail,
                authorBool: true,
              });
              if (queue[1])
                videoEmbed.addField('Next Song:', queue[1].title);
              message.channel.send(videoEmbed);
              message.guild.musicData.nowPlaying = queue[0];
              return queue.shift();
            })
            .on('finish', function () {
              if (queue.length >= 1) {
                return playSong(queue, message);
              } else {
                message.guild.musicData.isPlaying = false;
                message.guild.musicData.nowPlaying = null;
                message.guild.musicData.songDispatcher = null;
                return message.guild.me.voice.channel.leave();
              }
            })
            .on('error', function (e) {
              createEmbed(message, {
                color: 'errorRed',
                title: 'Whoops!',
                description:
                  'An error occured while playing the song',
                authorBool: true,
                send: 'channel',
              });
              console.error(e);
              message.guild.musicData.queue.length = 0;
              message.guild.musicData.isPlaying = false;
              message.guild.musicData.nowPlaying = null;
              message.guild.musicData.songDispatcher = null;
              return message.guild.me.voice.channel.leave();
            });
        })
        .catch(function (e) {
          console.error(e);
          return message.guild.me.voice.channel.leave();
        });
    }
    const unescapeHTML = (str) =>
      str.replace(
        /&amp;|&lt;|&gt;|&#39;|&quot;/g,
        (tag) =>
          ({
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&#39;': "'",
            '&quot;': '"',
          }[tag] || tag),
      );
    function constructSongObj(video, voiceChannel, message) {
      let duration = formatDuration(video.duration);
      if (duration == '00:00') duration = 'Live Stream';
      return {
        url: `https://www.youtube.com/watch?v=${video.raw.id}`,
        title: video.title,
        rawDuration: video.duration,
        duration,
        thumbnail: video.thumbnails.high.url,
        requester: message.author.tag,
        voiceChannel,
      };
    }
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return createEmbed(message, {
        color: 'errorRed',
        title: 'Whoops!',
        description:
          "You aren't in a voice channel! Join one and try again",
        authorBool: true,
        send: 'channel',
      });
    }

    const videos = await youtube
      .searchVideos(args.searchTerm, 5)
      .catch(function () {
        return createEmbed(message, {
          color: 'errorRed',
          title: 'Whoops!',
          description:
            'There was an error while searching for a video!',
          authorBool: true,
          send: 'channel',
        });
      });

    if (videos.length < 5) {
      return createEmbed(message, {
        color: 'errorRed',
        title: 'Whoops!',
        description: 'No videos were found while searching',
        authorBool: true,
        send: 'channel',
      });
    }
    const fieldArr = [];
    for (let i = 0; i < videos.length; i++) {
      fieldArr.push({
        name: 'Song ' + (i + 1),
        value: unescapeHTML(videos[i].title),
      });
    }
    const songEmbed = await createEmbed(message, {
      color: 'defaultBlue',
      title: 'Music selection',
      description: 'Pick a song from below using the reactions below',
      fields: fieldArr,
      authorBool: true,
      send: 'channel',
    });

    ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '🛑'].forEach(
      async (emoji) => await songEmbed.react(emoji),
    );
    let awaitReaction;
    try {
      awaitReaction = await songEmbed.awaitReactions(
        (reaction, user) => {
          return (
            ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '🛑'].some(
              (emoji) => reaction.emoji.name === emoji,
            ) && user.id === message.author.id
          );
        },
        { max: 1, time: 60000, errors: ['time'] },
      );
    } catch (e) {
      {
        songEmbed.delete();
        return createEmbed(message, {
          color: 'errorRed',
          title: 'Whoops!',
          description: 'Please try again',
          authorBool: true,
          send: 'channel',
        });
      }
    }

    const reaction = awaitReaction.first().emoji.name;
    songEmbed.delete();
    if (reaction === '🛑') return;
    const videoIndex = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'].indexOf(
      reaction,
    );
    let video;
    try {
      video = await youtube.getVideoByID(videos[videoIndex].id);
    } catch (error) {
      console.error(error);
      return createEmbed(message, {
        color: 'errorRed',
        title: 'Whoops!',
        description: 'An error occured while getting the video ID',
        authorBool: true,
        send: 'channel',
      });
    }

    if (
      video.duration.hours !== 0 ||
      (video.duration.hours >= 1 && video.duration.minutes > 31)
    ) {
      return createEmbed(message, {
        color: 'errorRed',
        title: 'Whoops!',
        description: "I don't support videos longer than 1 hour!",
        authorBool: true,
        send: 'channel',
      });
    }
    const songObj = constructSongObj(video, voiceChannel, message);
    message.guild.musicData.queue.push(songObj);
    if (!message.guild.musicData.isPlaying) {
      message.guild.musicData.isPlaying = true;
      playSong(message.guild.musicData.queue, message);
    } else if (message.guild.musicData.isPlaying) {
      return createEmbed(message, {
        color: 'defaultBlue',
        title: 'New song added to queue',
        fields: [
          {
            name: 'Title',
            value: songObj.title,
          },
          {
            name: 'Length',
            value: songObj.duration,
          },
          {
            name: 'URL',
            value: songObj.url,
          },
          {
            name: 'Requester',
            value: songObj.requester,
          },
        ],
        thumbnail: songObj.thumbnail,
        authorBool: true,
        send: 'channel',
      });
    }
  }
}

module.exports = PlayCommand;